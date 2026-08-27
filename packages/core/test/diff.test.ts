import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalizeScore, diffBarLines, diffSongs, type BarChange } from '../src/index.js';
import { loadFixture } from './helpers.js';

function counts(changes: readonly BarChange[]) {
  return {
    added: changes.filter(c => c.kind === 'added').length,
    removed: changes.filter(c => c.kind === 'removed').length,
    modified: changes.filter(c => c.kind === 'modified').length,
    moved: changes.filter(c => c.kind === 'moved').length
  };
}

function multiset(lines: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1);
  return map;
}

/**
 * Conservation law: starting from `before`, removing every line the diff claims to
 * have removed or replaced and adding every line it claims to have added must yield
 * exactly `after`. A diff that loses or invents music fails this.
 */
function conserves(before: readonly string[], after: readonly string[]): boolean {
  const changes = diffBarLines(before, after);
  const bag = multiset(before);
  const take = (line: string): boolean => {
    const n = bag.get(line);
    if (n === undefined || n === 0) return false;
    bag.set(line, n - 1);
    return true;
  };

  for (const change of changes) {
    if (change.beforeLine !== null && !take(change.beforeLine)) return false;
  }
  for (const change of changes) {
    if (change.afterLine !== null) bag.set(change.afterLine, (bag.get(change.afterLine) ?? 0) + 1);
  }

  const expected = multiset(after);
  for (const [line, n] of bag) {
    if (n === 0) continue;
    if (expected.get(line) !== n) return false;
  }
  for (const [line, n] of expected) {
    if ((bag.get(line) ?? 0) !== n) return false;
  }
  return true;
}

describe('diffBarLines', () => {
  it('reports nothing for identical input', () => {
    const lines = ['v0: 4[6/3]', 'v0: 4[6/5]', 'v0: 4[5/7]'];
    expect(diffBarLines(lines, lines)).toEqual([]);
  });

  it('reports a single insertion at the front as one added bar', () => {
    const before = ['a', 'b', 'c'];
    const after = ['new', 'a', 'b', 'c'];
    const changes = diffBarLines(before, after);
    expect(counts(changes)).toEqual({ added: 1, removed: 0, modified: 0, moved: 0 });
    expect(changes[0]?.afterIndex).toBe(0);
  });

  it('reports a single deletion as one removed bar', () => {
    const changes = diffBarLines(['a', 'b', 'c'], ['a', 'c']);
    expect(counts(changes)).toEqual({ added: 0, removed: 1, modified: 0, moved: 0 });
    expect(changes[0]?.beforeIndex).toBe(1);
  });

  it('pairs a replacement into one modified bar', () => {
    const changes = diffBarLines(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(counts(changes)).toEqual({ added: 0, removed: 0, modified: 1, moved: 0 });
    expect(changes[0]?.beforeIndex).toBe(1);
    expect(changes[0]?.afterIndex).toBe(1);
  });

  it('detects a bar moved elsewhere in the song', () => {
    const changes = diffBarLines(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'b']);
    expect(counts(changes).moved).toBe(1);
    const moved = changes.find(c => c.kind === 'moved');
    expect(moved?.beforeLine).toBe('b');
    expect(moved?.afterIndex).toBe(3);
  });

  it('never reports an index outside the input ranges', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 30 }),
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 30 }),
        (before, after) => {
          for (const change of diffBarLines(before, after)) {
            if (change.beforeIndex !== null) {
              expect(change.beforeIndex).toBeGreaterThanOrEqual(0);
              expect(change.beforeIndex).toBeLessThan(before.length);
              expect(change.beforeLine).toBe(before[change.beforeIndex]);
            }
            if (change.afterIndex !== null) {
              expect(change.afterIndex).toBeGreaterThanOrEqual(0);
              expect(change.afterIndex).toBeLessThan(after.length);
              expect(change.afterLine).toBe(after[change.afterIndex]);
            }
          }
        }
      )
    );
  });

  it('never uses the same bar position twice', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 30 }),
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 30 }),
        (before, after) => {
          const changes = diffBarLines(before, after);
          const beforeSeen = new Set<number>();
          const afterSeen = new Set<number>();
          for (const change of changes) {
            if (change.beforeIndex !== null) {
              expect(beforeSeen.has(change.beforeIndex)).toBe(false);
              beforeSeen.add(change.beforeIndex);
            }
            if (change.afterIndex !== null) {
              expect(afterSeen.has(change.afterIndex)).toBe(false);
              afterSeen.add(change.afterIndex);
            }
          }
        }
      )
    );
  });

  it('conserves every bar: nothing is lost or invented', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 25 }),
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 25 }),
        (before, after) => {
          expect(conserves(before, after)).toBe(true);
        }
      )
    );
  });

  it('reports nothing for any sequence against itself', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { maxLength: 40 }), lines => {
        expect(diffBarLines(lines, lines)).toEqual([]);
      })
    );
  });

  it('reports exactly one change per single-bar edit', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 25 }),
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 6 }),
        (before, rawIndex, replacement) => {
          const index = rawIndex % before.length;
          fc.pre(before[index] !== replacement);
          fc.pre(!before.includes(replacement));
          const after = [...before];
          after[index] = replacement;
          const changes = diffBarLines(before, after);
          expect(changes).toHaveLength(1);
          expect(changes[0]?.kind).toBe('modified');
        }
      )
    );
  });
});

describe('diffSongs', () => {
  it('finds no change between a version and itself', () => {
    const canonical = canonicalizeScore(loadFixture('song-a.gp'));
    const diff = diffSongs(canonical, canonical);
    expect(diff.hasChanges).toBe(false);
    expect(diff.structure).toEqual([]);
    expect(diff.tracks.every(track => track.status === 'unchanged')).toBe(true);
  });

  it('reports a one-note edit as exactly one note change', () => {
    // The acceptance test for the whole project: change one note in Guitar Pro,
    // and the diff shows one note.
    const before = canonicalizeScore(loadFixture('song-a.gp'));
    const after = canonicalizeScore(loadFixture('song-a-note-changed.gp'));
    const diff = diffSongs(before, after);

    expect(diff.structure).toEqual([]);
    const guitar = diff.tracks.find(track => track.name === 'Guitar 1');
    const bass = diff.tracks.find(track => track.name === 'Bass');
    expect(bass?.status).toBe('unchanged');
    expect(guitar).toMatchObject({ barsAdded: 0, barsRemoved: 0, barsModified: 1, barsMoved: 0 });

    const bar = guitar?.bars[0];
    expect(bar?.afterIndex).toBe(1);
    const noteChanges = bar?.voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes));
    expect(noteChanges).toHaveLength(1);
    expect(noteChanges?.[0]?.description).toBe('string 5: fret 7 → 9');
  });

  it('reports an inserted bar without rewriting the bars after it', () => {
    // A naive line diff reports this as a full rewrite. Anything other than a single
    // added bar here means the canonical format has leaked positional information.
    const before = canonicalizeScore(loadFixture('song-a.gp'));
    const after = canonicalizeScore(loadFixture('song-a-bar-inserted.gp'));
    const guitar = diffSongs(before, after).tracks.find(track => track.name === 'Guitar 1');

    expect(guitar).toMatchObject({ barsAdded: 1, barsRemoved: 0, barsModified: 0, barsMoved: 0 });
    expect(guitar?.bars[0]?.afterIndex).toBe(0);
  });

  it('is symmetric: undoing an edit reverses the diff', () => {
    const a = canonicalizeScore(loadFixture('song-a.gp'));
    const b = canonicalizeScore(loadFixture('song-a-bar-inserted.gp'));
    const forward = diffSongs(a, b).tracks.find(t => t.name === 'Guitar 1');
    const backward = diffSongs(b, a).tracks.find(t => t.name === 'Guitar 1');
    expect(forward?.barsAdded).toBe(backward?.barsRemoved);
    expect(forward?.barsRemoved).toBe(backward?.barsAdded);
  });
});
