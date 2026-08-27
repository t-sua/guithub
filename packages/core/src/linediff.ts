/**
 * Generic line diff used for bar sequences.
 *
 * Common prefixes and suffixes are trimmed first, which is what makes this fast in
 * practice: almost every real edit to a song touches a handful of bars in the middle
 * of an otherwise identical sequence. Only the remaining window goes through the
 * quadratic LCS, and that window is normally tiny.
 */

export type EditKind = 'equal' | 'delete' | 'insert';

export interface EditOp {
  readonly kind: EditKind;
  /** Index into the `before` array, or null for inserts. */
  readonly beforeIndex: number | null;
  /** Index into the `after` array, or null for deletes. */
  readonly afterIndex: number | null;
}

/**
 * Above this many cells the quadratic LCS is skipped and the changed window is
 * reported as a wholesale replacement. A 2000-bar song is roughly 90 minutes of
 * music, so this is a safety valve rather than a limit anyone should reach.
 */
const MAX_LCS_CELLS = 4_000_000;

export function diffLines(before: readonly string[], after: readonly string[]): EditOp[] {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < maxPrefix - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  const ops: EditOp[] = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ kind: 'equal', beforeIndex: i, afterIndex: i });
  }

  const beforeMid = before.slice(prefix, before.length - suffix);
  const afterMid = after.slice(prefix, after.length - suffix);
  for (const op of diffMiddle(beforeMid, afterMid, prefix)) ops.push(op);

  for (let i = 0; i < suffix; i++) {
    const beforeIndex = before.length - suffix + i;
    ops.push({ kind: 'equal', beforeIndex, afterIndex: after.length - suffix + i });
  }

  return ops;
}

function diffMiddle(
  before: readonly string[],
  after: readonly string[],
  offset: number
): EditOp[] {
  const n = before.length;
  const m = after.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return after.map((_, j) => ({
      kind: 'insert' as const,
      beforeIndex: null,
      afterIndex: offset + j
    }));
  }
  if (m === 0) {
    return before.map((_, i) => ({
      kind: 'delete' as const,
      beforeIndex: offset + i,
      afterIndex: null
    }));
  }

  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) {
    const ops: EditOp[] = [];
    for (let i = 0; i < n; i++) {
      ops.push({ kind: 'delete', beforeIndex: offset + i, afterIndex: null });
    }
    for (let j = 0; j < m; j++) {
      ops.push({ kind: 'insert', beforeIndex: null, afterIndex: offset + j });
    }
    return ops;
  }

  // lengths[i][j] = LCS length of before[i..] and after[j..]
  const width = m + 1;
  const lengths = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * width + (j + 1)]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + (j + 1)]!);
    }
  }

  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: 'equal', beforeIndex: offset + i, afterIndex: offset + j });
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + (j + 1)]!) {
      ops.push({ kind: 'delete', beforeIndex: offset + i, afterIndex: null });
      i++;
    } else {
      ops.push({ kind: 'insert', beforeIndex: null, afterIndex: offset + j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: 'delete', beforeIndex: offset + i, afterIndex: null });
    i++;
  }
  while (j < m) {
    ops.push({ kind: 'insert', beforeIndex: null, afterIndex: offset + j });
    j++;
  }
  return ops;
}
