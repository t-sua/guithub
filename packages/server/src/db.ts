import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/**
 * Schema migrations, applied in order. Each entry runs exactly once and the applied
 * count is stored in `user_version`, so upgrading is a matter of appending to this
 * array — never editing an existing entry.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);

  CREATE TABLE songs (
    id            TEXT PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    artist        TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    created_by    TEXT NOT NULL REFERENCES users(id),
    updated_at    TEXT NOT NULL,
    updated_by    TEXT REFERENCES users(id),
    head_commit   TEXT,
    version_count INTEGER NOT NULL DEFAULT 0,
    track_count   INTEGER NOT NULL DEFAULT 0,
    bar_count     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX songs_updated ON songs(updated_at DESC);
  `,
  `
  CREATE TABLE invites (
    id         TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    used_by    TEXT REFERENCES users(id)
  );
  CREATE INDEX invites_pending ON invites(used_at, expires_at);
  `,
  `
  CREATE TABLE password_resets (
    id         TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  CREATE INDEX password_resets_pending ON password_resets(used_at, expires_at);
  CREATE INDEX password_resets_user ON password_resets(user_id);
  `
];

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // WAL keeps readers from blocking the writer, which matters as soon as two people
  // are browsing history while a third uploads.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const applied = db.pragma('user_version', { simple: true }) as number;
  for (let version = applied; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version]!;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface SongRow {
  id: string;
  slug: string;
  title: string;
  artist: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string | null;
  head_commit: string | null;
  version_count: number;
  track_count: number;
  bar_count: number;
}
