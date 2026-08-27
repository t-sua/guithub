import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SongMetadata } from '@guithub/core';
import type { Db, SongRow } from './db.js';
import { initBareRepo } from './git.js';
import type { CommitVersionResult } from './songs.js';

/** Every song is a bare git repository under `<dataDir>/songs/<id>.git`. */
export function repoDirFor(dataDir: string, songId: string): string {
  return join(dataDir, 'songs', `${songId}.git`);
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'song'
  );
}

function uniqueSlug(db: Db, base: string): string {
  const exists = db.prepare('SELECT 1 FROM songs WHERE slug = ?');
  if (!exists.get(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!exists.get(candidate)) return candidate;
  }
}

export interface CreateSongInput {
  readonly title: string;
  readonly artist?: string;
  readonly userId: string;
  readonly dataDir: string;
}

export async function createSong(db: Db, input: CreateSongInput): Promise<SongRow> {
  const now = new Date().toISOString();
  const row: SongRow = {
    id: randomUUID(),
    slug: uniqueSlug(db, slugify(input.title)),
    title: input.title,
    artist: input.artist ?? '',
    created_at: now,
    created_by: input.userId,
    updated_at: now,
    updated_by: null,
    head_commit: null,
    version_count: 0,
    track_count: 0,
    bar_count: 0
  };

  // The repository is created before the row so that a crash leaves at most an
  // orphaned empty repo, never a song row pointing at storage that does not exist.
  await initBareRepo(repoDirFor(input.dataDir, row.id));

  db.prepare(
    `INSERT INTO songs
       (id, slug, title, artist, created_at, created_by, updated_at, updated_by,
        head_commit, version_count, track_count, bar_count)
     VALUES
       (@id, @slug, @title, @artist, @created_at, @created_by, @updated_at, @updated_by,
        @head_commit, @version_count, @track_count, @bar_count)`
  ).run(row);
  return row;
}

export function listSongs(db: Db): SongRow[] {
  return db.prepare('SELECT * FROM songs ORDER BY updated_at DESC').all() as SongRow[];
}

export function getSongBySlug(db: Db, slug: string): SongRow | undefined {
  return db.prepare('SELECT * FROM songs WHERE slug = ?').get(slug) as SongRow | undefined;
}

export function getSongById(db: Db, id: string): SongRow | undefined {
  return db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined;
}

/**
 * Updates the song index after a version lands. The index is a cache over the git
 * repositories: it makes listing fast, and it can be rebuilt from them at any time.
 */
export function recordVersion(
  db: Db,
  songId: string,
  result: CommitVersionResult,
  userId: string
): void {
  const metadata: SongMetadata = result.metadata;
  db.prepare(
    `UPDATE songs SET
       title         = CASE WHEN @title <> '' THEN @title ELSE title END,
       artist        = @artist,
       updated_at    = @updated_at,
       updated_by    = @updated_by,
       head_commit   = @head_commit,
       version_count = version_count + 1,
       track_count   = @track_count,
       bar_count     = @bar_count
     WHERE id = @id`
  ).run({
    id: songId,
    title: metadata.title,
    artist: metadata.artist,
    updated_at: new Date().toISOString(),
    updated_by: userId,
    head_commit: result.commit,
    track_count: metadata.tracks.length,
    bar_count: metadata.barCount
  });
}

export function deleteSong(db: Db, songId: string): void {
  db.prepare('DELETE FROM songs WHERE id = ?').run(songId);
}
