import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db, SessionRow, UserRow } from './db.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * Passwords are hashed with scrypt from Node's own crypto module.
 *
 * scrypt is memory-hard and part of the standard library, so there is no native
 * module to compile and nothing to go stale. For a self-hosted instance with a
 * handful of hand-created accounts this is the right trade: strong, and impossible
 * to get wrong at install time.
 */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const SESSION_COOKIE = 'guithub_session';
export const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');
  try {
    const derived = await scryptAsync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface PublicUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly isAdmin: boolean;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    isAdmin: row.is_admin === 1
  };
}

export interface NewUser {
  username: string;
  displayName: string;
  email: string;
  password: string;
  isAdmin?: boolean;
}

export interface PreparedUser {
  readonly row: UserRow;
  readonly publicUser: PublicUser;
  /**
   * Inserts the row. Synchronous on purpose: better-sqlite3 transactions cannot span
   * an await, so hashing happens first and only this call runs inside the transaction.
   */
  readonly insert: () => void;
}

/**
 * Hashes the password and builds the row without writing it, so callers that must
 * insert inside a transaction (redeeming an invite) can do the slow part beforehand.
 */
export async function prepareUser(db: Db, input: NewUser): Promise<PreparedUser> {
  const row: UserRow = {
    id: randomUUID(),
    username: input.username,
    display_name: input.displayName,
    email: input.email,
    password_hash: await hashPassword(input.password),
    is_admin: input.isAdmin ? 1 : 0,
    created_at: new Date().toISOString()
  };
  const statement = db.prepare(
    `INSERT INTO users (id, username, display_name, email, password_hash, is_admin, created_at)
     VALUES (@id, @username, @display_name, @email, @password_hash, @is_admin, @created_at)`
  );
  return { row, publicUser: toPublicUser(row), insert: () => void statement.run(row) };
}

export async function createUser(db: Db, input: NewUser): Promise<PublicUser> {
  const prepared = await prepareUser(db, input);
  prepared.insert();
  return prepared.publicUser;
}

/**
 * Replaces a password, and drops the user's other sessions.
 *
 * Signing the other sessions out is the point rather than a side effect: changing a
 * password is how you respond to one having leaked, and that is worthless if a stolen
 * session cookie keeps working afterwards. The session doing the change is kept so
 * nobody is thrown out of the browser they are sitting at.
 *
 * Hashing happens before the transaction because better-sqlite3 transactions cannot
 * span an await — the same constraint prepareUser works around.
 */
export async function updatePassword(
  db: Db,
  userId: string,
  password: string,
  keepSessionId?: string
): Promise<void> {
  const hash = await hashPassword(password);
  const apply = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    if (keepSessionId === undefined) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    } else {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, keepSessionId);
    }
  });
  apply();
}

export function findUserByUsername(db: Db, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | UserRow
    | undefined;
}

export function findUserById(db: Db, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function listUsers(db: Db): PublicUser[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY username').all() as UserRow[];
  return rows.map(toPublicUser);
}

export function countUsers(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

/**
 * Verifies a username and password.
 *
 * A missing user still costs a full hash comparison so that response timing does not
 * reveal which usernames exist.
 */
export async function authenticate(
  db: Db,
  username: string,
  password: string
): Promise<UserRow | null> {
  const user = findUserByUsername(db, username);
  if (!user) {
    await verifyPassword(password, await DUMMY_HASH);
    return null;
  }
  return (await verifyPassword(password, user.password_hash)) ? user : null;
}

const DUMMY_HASH: Promise<string> = hashPassword(randomBytes(24).toString('hex'));

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(db: Db, userId: string): SessionRow {
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const row: SessionRow = {
    id: randomBytes(32).toString('base64url'),
    user_id: userId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString()
  };
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (@id, @user_id, @created_at, @expires_at)'
  ).run(row);
  return row;
}

export function findSessionUser(db: Db, sessionId: string): UserRow | null {
  const row = db
    .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
    .get(sessionId, new Date().toISOString()) as SessionRow | undefined;
  if (!row) return null;
  return findUserById(db, row.user_id) ?? null;
}

export function deleteSession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function pruneExpiredSessions(db: Db): number {
  const result = db
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .run(new Date().toISOString());
  return result.changes;
}
