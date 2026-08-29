import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db, UserRow } from './db.js';
import { hashPassword, toPublicUser, type PublicUser } from './auth.js';

/**
 * Password resets, for someone who has forgotten theirs.
 *
 * An admin issues a single-use link for an existing account; whoever opens it chooses
 * a new password. As with invites, only the SHA-256 of the token is stored, so a copy
 * of the database cannot be used to claim a reset.
 *
 * The honest limitation: an admin who issues a link could redeem it themselves instead
 * of sending it, so this does not make it impossible for an admin to take over an
 * account. It makes it *auditable* rather than silent — every reset records who issued
 * it, for whom, and when it was used, and those rows are kept after use. Closing the
 * gap entirely needs a link the user requests for themselves, which needs email that
 * this instance cannot send. Given the admin also has a shell on the server, the
 * distinction is about accountability rather than capability.
 *
 * The window is deliberately short. An invite is a standing offer to join; a reset is
 * an answer to someone stuck right now, and a link that can take over an existing
 * account with real history behind it should not linger in a chat log for a week.
 */

export const RESET_TTL_HOURS = 12;
const TOKEN_BYTES = 32;

export interface ResetRow {
  id: string;
  token_hash: string;
  user_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface PendingReset {
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly issuedBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly used: boolean;
  readonly usedAt: string | null;
}

export type ResetProblem = 'unknown' | 'used' | 'expired';

export class ResetError extends Error {
  constructor(
    readonly problem: ResetProblem,
    message: string
  ) {
    super(message);
    this.name = 'ResetError';
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a reset and returns the plaintext token. This is the only moment the token
 * exists in readable form; it is never recoverable afterwards.
 *
 * Any earlier unused reset for the same person is dropped. Two live links for one
 * account is one more than anybody needs, and the older one is usually the one that
 * went astray.
 */
export function createReset(
  db: Db,
  options: { userId: string; createdBy: string; ttlHours?: number; now?: Date }
): { token: string; reset: ResetRow } {
  const now = options.now ?? new Date();
  const ttl = options.ttlHours ?? RESET_TTL_HOURS;
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  const row: ResetRow = {
    id: randomUUID(),
    token_hash: hashToken(token),
    user_id: options.userId,
    created_by: options.createdBy,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl * 60 * 60 * 1000).toISOString(),
    used_at: null
  };

  const issue = db.transaction(() => {
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(
      options.userId
    );
    db.prepare(
      `INSERT INTO password_resets (id, token_hash, user_id, created_by, created_at, expires_at, used_at)
       VALUES (@id, @token_hash, @user_id, @created_by, @created_at, @expires_at, @used_at)`
    ).run(row);
  });
  issue();

  return { token, reset: row };
}

/** Looks a reset up by its plaintext token, refusing used or expired ones. */
export function findUsableReset(db: Db, token: string, now = new Date()): ResetRow {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(
    hashToken(token)
  ) as ResetRow | undefined;
  if (!row) throw new ResetError('unknown', 'This reset link is not valid.');
  if (row.used_at !== null) {
    throw new ResetError('used', 'This reset link has already been used.');
  }
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new ResetError('expired', 'This reset link has expired. Ask for a new one.');
  }
  return row;
}

/** The account a reset link belongs to, so the page can say whose it is. */
export function resetTarget(db: Db, row: ResetRow): UserRow {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as
    | UserRow
    | undefined;
  if (!user) throw new ResetError('unknown', 'This reset link is not valid.');
  return user;
}

/**
 * Redeems a reset link and sets the new password.
 *
 * Every session belonging to that account is deleted, including any the person had
 * open elsewhere: if the reason for the reset is that someone else got in, leaving
 * their session alive would defeat the whole exercise. The caller issues a fresh
 * session afterwards for the browser doing the reset.
 *
 * Hashing happens before the transaction, because better-sqlite3 transactions cannot
 * span an await. The claim is conditional on the row still being unused, so two people
 * racing the same link cannot both get through.
 */
export async function acceptReset(
  db: Db,
  input: { token: string; password: string },
  now = new Date()
): Promise<PublicUser> {
  const reset = findUsableReset(db, input.token, now);
  const user = resetTarget(db, reset);
  const passwordHash = await hashPassword(input.password);

  const claim = db.transaction(() => {
    const claimed = db
      .prepare('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .run(now.toISOString(), reset.id);
    if (claimed.changes !== 1) {
      throw new ResetError('used', 'This reset link has already been used.');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  });
  claim();

  return toPublicUser({ ...user, password_hash: passwordHash });
}

/**
 * Recent resets, newest first, with the names needed to read them at a glance.
 *
 * Used rows are kept rather than deleted: they are the audit trail that makes an
 * admin-issued reset accountable instead of invisible.
 */
export function listResets(db: Db): PendingReset[] {
  const rows = db
    .prepare(
      `SELECT r.*, u.username AS username, u.display_name AS display_name,
              a.display_name AS issued_by
         FROM password_resets r
         JOIN users u ON u.id = r.user_id
         JOIN users a ON a.id = r.created_by
        ORDER BY r.created_at DESC
        LIMIT 100`
    )
    .all() as (ResetRow & { username: string; display_name: string; issued_by: string })[];

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    issuedBy: row.issued_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    used: row.used_at !== null,
    usedAt: row.used_at
  }));
}

/** Revokes an unused reset. Used ones stay as the record of what happened. */
export function revokeReset(db: Db, id: string): boolean {
  return (
    db.prepare('DELETE FROM password_resets WHERE id = ? AND used_at IS NULL').run(id).changes === 1
  );
}

export function pruneExpiredResets(db: Db, now = new Date()): number {
  return db
    .prepare('DELETE FROM password_resets WHERE used_at IS NULL AND expires_at <= ?')
    .run(now.toISOString()).changes;
}
