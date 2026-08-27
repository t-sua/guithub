import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffSongs } from '@guithub/core';
import { initBareRepo, resolveRef } from '../src/git.js';
import { blameTrack, listVersions, readTextAt } from '../src/history.js';
import {
  commitVersion,
  readCanonicalAt,
  readOriginalAt,
  readProvenanceAt,
  parseScore,
  UploadError,
  MAIN_REF
} from '../src/songs.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');

const ALICE = { name: 'Alice', email: 'alice@band.test' };
const BOB = { name: 'Bob', email: 'bob@band.test' };

let repoDir: string;
let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'guithub-test-'));
  repoDir = join(workDir, 'song.git');
  await initBareRepo(repoDir);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function upload(
  fixture: string,
  author: { name: string; email: string },
  message: string,
  when: Date
) {
  const bytes = await readFile(join(FIXTURES, fixture));
  return commitVersion({ repoDir, bytes, filename: fixture, message, author, when });
}

describe('commitVersion', () => {
  it('creates the first version with the expected layout', async () => {
    const result = await upload('song-a.gp', ALICE, 'First pass at the riff', new Date('2026-01-05T10:00:00Z'));

    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await resolveRef(repoDir, MAIN_REF)).toBe(result.commit);
    expect(result.metadata.title).toBe('Peppy Crane');

    expect(await readTextAt(repoDir, result.commit, 'song.json')).toContain('"title": "Peppy Crane"');
    expect(await readTextAt(repoDir, result.commit, 'structure.tab')).toContain('tempo=132');
    const guitar = await readTextAt(repoDir, result.commit, 'tracks/01-guitar-1.tab');
    expect(guitar?.split('\n').filter(Boolean)).toHaveLength(4);
  });

  it('stores the uploaded file byte for byte', async () => {
    // The whole promise of the storage model: what you upload is what you download.
    const source = await readFile(join(FIXTURES, 'song-a.gp'));
    const result = await upload('song-a.gp', ALICE, 'v1', new Date('2026-01-05T10:00:00Z'));

    const original = await readOriginalAt(repoDir, result.commit);
    expect(original?.filename).toBe('song-a.gp');
    expect(original?.bytes.equals(source)).toBe(true);
  });

  it('records provenance for each version', async () => {
    const result = await upload('song-a.gp', ALICE, 'v1', new Date('2026-01-05T10:00:00Z'));
    const provenance = await readProvenanceAt(repoDir, result.commit);
    expect(provenance).toMatchObject({
      originalFilename: 'song-a.gp',
      uploadedAt: '2026-01-05T10:00:00.000Z',
      canonicalFormat: 1
    });
    expect(provenance?.originalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains versions and attributes each to its author', async () => {
    await upload('song-a.gp', ALICE, 'First pass at the riff', new Date('2026-01-05T10:00:00Z'));
    await upload('song-a-note-changed.gp', BOB, 'Moved the 7 to a 9', new Date('2026-01-06T11:30:00Z'));

    const versions = await listVersions(repoDir);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ authorName: 'Bob', message: 'Moved the 7 to a 9' });
    expect(versions[1]).toMatchObject({ authorName: 'Alice', message: 'First pass at the riff' });
  });

  it('rejects a file it cannot parse', async () => {
    const bytes = Buffer.from('this is not a guitar pro file');
    await expect(
      commitVersion({ repoDir, bytes, filename: 'broken.gp5', message: 'x', author: ALICE })
    ).rejects.toThrow(UploadError);
    // Nothing was committed, so the song is untouched.
    expect(await resolveRef(repoDir, MAIN_REF)).toBeNull();
  });

  it('rejects an unsupported file type before parsing', () => {
    expect(() => parseScore(Buffer.from('x'), 'song.pdf')).toThrow(/Unsupported file type/);
  });

  it('refuses a concurrent upload rather than losing one', async () => {
    const first = await upload('song-a.gp', ALICE, 'v1', new Date('2026-01-05T10:00:00Z'));
    const bytesA = await readFile(join(FIXTURES, 'song-a-note-changed.gp'));
    const bytesB = await readFile(join(FIXTURES, 'song-a-bar-inserted.gp'));

    // Both uploads read the same parent tip; only one may win.
    const results = await Promise.allSettled([
      commitVersion({ repoDir, bytes: bytesA, filename: 'a.gp', message: 'A', author: ALICE }),
      commitVersion({ repoDir, bytes: bytesB, filename: 'b.gp', message: 'B', author: BOB })
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const versions = await listVersions(repoDir);
    expect(versions[versions.length - 1]?.commit).toBe(first.commit);
    // Whatever landed, history is a clean chain with no lost or duplicated version.
    expect(versions.length).toBe(1 + fulfilled.length);
  });
});

describe('diffing two stored versions', () => {
  it('reports a one-note edit as exactly one note change', async () => {
    const v1 = await upload('song-a.gp', ALICE, 'v1', new Date('2026-01-05T10:00:00Z'));
    const v2 = await upload('song-a-note-changed.gp', BOB, 'v2', new Date('2026-01-06T10:00:00Z'));

    const before = await readCanonicalAt(repoDir, v1.commit);
    const after = await readCanonicalAt(repoDir, v2.commit);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();

    const diff = diffSongs(before!, after!);
    const guitar = diff.tracks.find(track => track.name === 'Guitar 1');
    expect(guitar).toMatchObject({ barsAdded: 0, barsRemoved: 0, barsModified: 1 });
    const notes = guitar?.bars[0]?.voices.flatMap(v => v.beats.flatMap(b => b.notes));
    expect(notes?.[0]?.description).toBe('string 5: fret 7 → 9');
  });
});

describe('blameTrack', () => {
  it('attributes each bar to whoever last changed it', async () => {
    await upload('song-a.gp', ALICE, 'First pass at the riff', new Date('2026-01-05T10:00:00Z'));
    const v2 = await upload('song-a-note-changed.gp', BOB, 'Moved the 7 to a 9', new Date('2026-01-06T11:30:00Z'));

    const blame = await blameTrack(repoDir, v2.commit, 'tracks/01-guitar-1.tab');
    expect(blame).toHaveLength(4);
    expect(blame.map(line => line.bar)).toEqual([0, 1, 2, 3]);

    // Bob touched only bar 2. Everything else is still Alice's.
    expect(blame[1]).toMatchObject({ authorName: 'Bob', summary: 'Moved the 7 to a 9' });
    for (const index of [0, 2, 3]) {
      expect(blame[index]).toMatchObject({ authorName: 'Alice' });
    }
  });

  it('keeps credit with the author when a bar is inserted above', async () => {
    // This is the case that makes blame worth having: adding an intro must not
    // reassign the whole song to whoever added it.
    await upload('song-a.gp', ALICE, 'First pass at the riff', new Date('2026-01-05T10:00:00Z'));
    const v2 = await upload('song-a-bar-inserted.gp', BOB, 'Added an intro bar', new Date('2026-01-06T11:30:00Z'));

    const blame = await blameTrack(repoDir, v2.commit, 'tracks/01-guitar-1.tab');
    expect(blame).toHaveLength(5);
    expect(blame[0]).toMatchObject({ authorName: 'Bob', summary: 'Added an intro bar' });
    for (const index of [1, 2, 3, 4]) {
      expect(blame[index], `bar ${index + 1}`).toMatchObject({ authorName: 'Alice' });
    }
  });
});
