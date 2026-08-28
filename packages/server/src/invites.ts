import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { prepareUser, type PublicUser } from './auth.js';

/**
 * Invite-only account creation.
 *
 * An admin issues a link; whoever opens it chooses their own username and password.
 * The plaintext token exists only in the link — the database stores its SHA-256, so a
 * copy of the database (a backup, a stolen disk) cannot be used to claim an invite.
 * Tokens are single-use and expire.
 */

export const INVITE_TTL_DAYS = 7;
const TOKEN_BYTES = 32;

export interface InviteRow {
  id: string;
  token_hash: string;
  label: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
}

export interface PendingInvite {
  readonly id: string;
  readonly label: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly used: boolean;
  readonly usedAt: string | null;
}

export type InviteProblem = 'unknown' | 'used' | 'expired';

export class InviteError extends Error {
  constructor(
    readonly problem: InviteProblem,
    message: string
  ) {
    super(message);
    this.name = 'InviteError';
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toPendingInvite(row: InviteRow): PendingInvite {
  return {
    id: row.id,
    label: row.label,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    used: row.used_at !== null,
    usedAt: row.used_at
  };
}

/**
 * Creates an invite and returns the plaintext token. This is the only moment the token
 * exists in readable form; it is never recoverable afterwards.
 */
export function createInvite(
  db: Db,
  options: { createdBy: string; label?: string; ttlDays?: number; now?: Date }
): { token: string; invite: PendingInvite } {
  const now = options.now ?? new Date();
  const ttl = options.ttlDays ?? INVITE_TTL_DAYS;
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  const row: InviteRow = {
    id: randomUUID(),
    token_hash: hashToken(token),
    label: (options.label ?? '').slice(0, 100),
    created_by: options.createdBy,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl * 24 * 60 * 60 * 1000).toISOString(),
    used_at: null,
    used_by: null
  };

  db.prepare(
    `INSERT INTO invites (id, token_hash, label, created_by, created_at, expires_at, used_at, used_by)
     VALUES (@id, @token_hash, @label, @created_by, @created_at, @expires_at, @used_at, @used_by)`
  ).run(row);

  return { token, invite: toPendingInvite(row) };
}

/** Looks an invite up by its plaintext token, refusing used or expired ones. */
export function findUsableInvite(db: Db, token: string, now = new Date()): InviteRow {
  const row = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hashToken(token)) as
    | InviteRow
    | undefined;
  if (!row) throw new InviteError('unknown', 'This invite link is not valid.');
  if (row.used_at !== null) throw new InviteError('used', 'This invite link has already been used.');
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new InviteError('expired', 'This invite link has expired. Ask for a new one.');
  }
  return row;
}

export interface AcceptInviteInput {
  readonly token: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

/**
 * Redeems an invite and creates the account.
 *
 * The invite is marked used in the same transaction as the account insert, and the
 * update is conditional on it still being unused, so two people racing the same link
 * cannot both get through.
 */
export async function acceptInvite(
  db: Db,
  input: AcceptInviteInput,
  now = new Date()
): Promise<PublicUser> {
  const invite = findUsableInvite(db, input.token, now);

  // Hashing is slow and must not happen inside the transaction.
  const user = await prepareUser(db, {
    username: input.username,
    displayName: input.displayName,
    email: input.email,
    password: input.password,
    isAdmin: false
  });

  const claim = db.transaction(() => {
    // The user row must exist before the invite can point at it: invites.used_by is a
    // foreign key. If the claim then fails because someone else got there first, the
    // transaction rolls the account back out with it.
    user.insert();
    const claimed = db
      .prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL')
      .run(now.toISOString(), user.row.id, invite.id);
    if (claimed.changes !== 1) {
      throw new InviteError('used', 'This invite link has already been used.');
    }
  });
  claim();

  return user.publicUser;
}

export function listInvites(db: Db): PendingInvite[] {
  const rows = db
    .prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 100')
    .all() as InviteRow[];
  return rows.map(toPendingInvite);
}

/** Revokes an unused invite. Used invites stay as a record of who joined how. */
export function revokeInvite(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL').run(id).changes === 1;
}

export function pruneExpiredInvites(db: Db, now = new Date()): number {
  return db
    .prepare('DELETE FROM invites WHERE used_at IS NULL AND expires_at <= ?')
    .run(now.toISOString()).changes;
}
