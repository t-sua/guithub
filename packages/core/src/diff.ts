import type { CanonicalSong, CanonicalTrack, SongMetadata } from './types.js';
import { diffLines, type EditOp } from './linediff.js';
import {
  parseBarLine,
  type ParsedBar,
  type ParsedBeat,
  type ParsedNote,
  type ParsedVoice
} from './tokenize.js';
import {
  describeBarAttr,
  describeBeatFlag,
  describeNoteFlag,
  durationName,
  scanFlags,
  type Flag
} from './describe.js';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type ChangeKind = 'added' | 'removed' | 'modified' | 'moved';

export interface NoteChange {
  readonly kind: ChangeKind;
  readonly before: ParsedNote | null;
  readonly after: ParsedNote | null;
  readonly description: string;
}

export interface BeatChange {
  readonly kind: ChangeKind;
  readonly beforeIndex: number | null;
  readonly afterIndex: number | null;
  readonly before: ParsedBeat | null;
  readonly after: ParsedBeat | null;
  readonly notes: readonly NoteChange[];
  readonly description: string;
}

export interface VoiceChange {
  readonly label: string;
  readonly beats: readonly BeatChange[];
}

export interface BarChange {
  readonly kind: ChangeKind;
  /** Zero-based bar index in the earlier version, or null when the bar is new. */
  readonly beforeIndex: number | null;
  /** Zero-based bar index in the later version, or null when the bar was deleted. */
  readonly afterIndex: number | null;
  readonly beforeLine: string | null;
  readonly afterLine: string | null;
  readonly attrs: readonly string[];
  readonly voices: readonly VoiceChange[];
  readonly summary: string;
}

export type TrackStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'unchanged';

export interface TrackDiff {
  readonly status: TrackStatus;
  readonly name: string;
  readonly previousName: string | null;
  readonly path: string | null;
  readonly previousPath: string | null;
  readonly bars: readonly BarChange[];
  readonly barsAdded: number;
  readonly barsRemoved: number;
  readonly barsModified: number;
  readonly barsMoved: number;
}

export interface FieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface SongDiff {
  readonly metadata: readonly FieldChange[];
  /** Changes to time signature, tempo, key, sections and repeats. */
  readonly structure: readonly BarChange[];
  readonly tracks: readonly TrackDiff[];
  readonly hasChanges: boolean;
}

// ---------------------------------------------------------------------------
// Song level
// ---------------------------------------------------------------------------

export function diffSongs(before: CanonicalSong, after: CanonicalSong): SongDiff {
  const beforeMeta = JSON.parse(before.songJson) as SongMetadata;
  const afterMeta = JSON.parse(after.songJson) as SongMetadata;

  const metadata: FieldChange[] = [];
  const scalarFields = [
    'title',
    'subTitle',
    'artist',
    'album',
    'words',
    'music',
    'copyright',
    'tempo',
    'tempoLabel'
  ] as const;
  for (const field of scalarFields) {
    const a = String(beforeMeta[field] ?? '');
    const b = String(afterMeta[field] ?? '');
    if (a !== b) metadata.push({ field, before: a, after: b });
  }

  const structure = diffBarLines(before.structure, after.structure);
  const tracks = diffTrackLists(before.tracks, after.tracks, beforeMeta, afterMeta, metadata);
  const hasChanges =
    metadata.length > 0 ||
    structure.length > 0 ||
    tracks.some(track => track.status !== 'unchanged');
  return { metadata, structure, tracks, hasChanges };
}

function diffTrackLists(
  before: readonly CanonicalTrack[],
  after: readonly CanonicalTrack[],
  beforeMeta: SongMetadata,
  afterMeta: SongMetadata,
  metadata: FieldChange[]
): TrackDiff[] {
  const pairs = pairTracks(before, after);
  const diffs: TrackDiff[] = [];

  for (const [beforeTrack, afterTrack] of pairs) {
    if (beforeTrack && afterTrack) {
      recordTuningChange(beforeTrack, afterTrack, beforeMeta, afterMeta, metadata);
      diffs.push(diffTrack(beforeTrack, afterTrack));
    } else if (afterTrack) {
      diffs.push(emptyTrackDiff('added', afterTrack));
    } else if (beforeTrack) {
      diffs.push(emptyTrackDiff('removed', beforeTrack));
    }
  }
  return diffs;
}

/**
 * Tracks are matched by name first, falling back to score position. Name matching
 * survives reordering in Guitar Pro; the positional fallback survives a rename.
 */
function pairTracks(
  before: readonly CanonicalTrack[],
  after: readonly CanonicalTrack[]
): Array<[CanonicalTrack | null, CanonicalTrack | null]> {
  const pairs: Array<[CanonicalTrack | null, CanonicalTrack | null]> = [];
  const remainingBefore = new Set(before.map(track => track.index));
  const byName = new Map<string, CanonicalTrack[]>();
  for (const track of before) {
    const bucket = byName.get(track.name);
    if (bucket) bucket.push(track);
    else byName.set(track.name, [track]);
  }

  for (const afterTrack of after) {
    const bucket = byName.get(afterTrack.name);
    const match = bucket?.find(track => remainingBefore.has(track.index));
    if (match) {
      remainingBefore.delete(match.index);
      pairs.push([match, afterTrack]);
    } else {
      pairs.push([null, afterTrack]);
    }
  }

  // Anything left over pairs positionally with an unmatched new track (a rename),
  // otherwise it was genuinely deleted.
  for (const beforeTrack of before) {
    if (!remainingBefore.has(beforeTrack.index)) continue;
    const slot = pairs.findIndex(
      ([b, a]) => b === null && a !== null && a.index === beforeTrack.index
    );
    if (slot >= 0) {
      const existing = pairs[slot]!;
      pairs[slot] = [beforeTrack, existing[1]];
      remainingBefore.delete(beforeTrack.index);
    } else {
      pairs.push([beforeTrack, null]);
    }
  }
  return pairs;
}

function recordTuningChange(
  beforeTrack: CanonicalTrack,
  afterTrack: CanonicalTrack,
  beforeMeta: SongMetadata,
  afterMeta: SongMetadata,
  metadata: FieldChange[]
): void {
  const a = beforeMeta.tracks.find(track => track.index === beforeTrack.index);
  const b = afterMeta.tracks.find(track => track.index === afterTrack.index);
  if (!a || !b) return;
  if (a.tuning.join(',') !== b.tuning.join(',')) {
    metadata.push({
      field: `${afterTrack.name} tuning`,
      before: a.tuning.join(' '),
      after: b.tuning.join(' ')
    });
  }
  if (a.capo !== b.capo) {
    metadata.push({
      field: `${afterTrack.name} capo`,
      before: String(a.capo),
      after: String(b.capo)
    });
  }
}

function emptyTrackDiff(status: 'added' | 'removed', track: CanonicalTrack): TrackDiff {
  const bars: BarChange[] = track.lines.map((line, index) => ({
    kind: status,
    beforeIndex: status === 'removed' ? index : null,
    afterIndex: status === 'added' ? index : null,
    beforeLine: status === 'removed' ? line : null,
    afterLine: status === 'added' ? line : null,
    attrs: [],
    voices: [],
    summary: status === 'added' ? 'bar added' : 'bar removed'
  }));
  return {
    status,
    name: track.name,
    previousName: status === 'removed' ? track.name : null,
    path: status === 'added' ? track.path : null,
    previousPath: status === 'removed' ? track.path : null,
    bars,
    barsAdded: status === 'added' ? bars.length : 0,
    barsRemoved: status === 'removed' ? bars.length : 0,
    barsModified: 0,
    barsMoved: 0
  };
}

// ---------------------------------------------------------------------------
// Track level
// ---------------------------------------------------------------------------

export function diffTrack(before: CanonicalTrack, after: CanonicalTrack): TrackDiff {
  const bars = diffBarLines(before.lines, after.lines);
  const barsAdded = bars.filter(bar => bar.kind === 'added').length;
  const barsRemoved = bars.filter(bar => bar.kind === 'removed').length;
  const barsModified = bars.filter(bar => bar.kind === 'modified').length;
  const barsMoved = bars.filter(bar => bar.kind === 'moved').length;

  const renamed = before.name !== after.name;
  const changed = bars.length > 0;
  const status: TrackStatus = changed ? 'modified' : renamed ? 'renamed' : 'unchanged';

  return {
    status,
    name: after.name,
    previousName: renamed ? before.name : null,
    path: after.path,
    previousPath: before.path,
    bars,
    barsAdded,
    barsRemoved,
    barsModified,
    barsMoved
  };
}

/**
 * Converts a raw edit script into musical changes. Runs of deletes immediately
 * followed by inserts are paired into modifications, so an edited bar reads as one
 * change rather than a removal plus an unrelated addition. Whatever is left over is
 * checked for exact content matches elsewhere in the song and reported as a move —
 * that is what stops "I added an intro bar" from looking like a full rewrite.
 */
export function diffBarLines(
  before: readonly string[],
  after: readonly string[]
): BarChange[] {
  const ops = diffLines(before, after);
  const runs = groupRuns(ops);

  const changes: BarChange[] = [];
  const pendingRemoved: BarChange[] = [];
  const pendingAdded: BarChange[] = [];

  for (const run of runs) {
    if (run.kind === 'equal') continue;
    if (run.kind === 'delete') {
      const inserts = run.pairedInserts ?? [];
      const paired = Math.min(run.ops.length, inserts.length);
      for (let i = 0; i < paired; i++) {
        const beforeIndex = run.ops[i]!.beforeIndex!;
        const afterIndex = inserts[i]!.afterIndex!;
        changes.push(
          buildModifiedBar(beforeIndex, afterIndex, before[beforeIndex]!, after[afterIndex]!)
        );
      }
      for (let i = paired; i < run.ops.length; i++) {
        const beforeIndex = run.ops[i]!.beforeIndex!;
        pendingRemoved.push(simpleBar('removed', beforeIndex, null, before[beforeIndex]!, null));
      }
      for (let i = paired; i < inserts.length; i++) {
        const afterIndex = inserts[i]!.afterIndex!;
        pendingAdded.push(simpleBar('added', null, afterIndex, null, after[afterIndex]!));
      }
    } else if (run.kind === 'insert' && !run.consumed) {
      for (const op of run.ops) {
        const afterIndex = op.afterIndex!;
        pendingAdded.push(simpleBar('added', null, afterIndex, null, after[afterIndex]!));
      }
    }
  }

  markMoves(pendingRemoved, pendingAdded);
  changes.push(...pendingRemoved, ...pendingAdded);
  changes.sort(compareBarChanges);
  return changes;
}

interface Run {
  kind: 'equal' | 'delete' | 'insert';
  ops: EditOp[];
  pairedInserts?: EditOp[];
  consumed?: boolean;
}

function groupRuns(ops: readonly EditOp[]): Run[] {
  const runs: Run[] = [];
  for (const op of ops) {
    const last = runs[runs.length - 1];
    if (last && last.kind === op.kind) last.ops.push(op);
    else runs.push({ kind: op.kind, ops: [op] });
  }
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const next = runs[i + 1];
    if (run.kind === 'delete' && next && next.kind === 'insert') {
      run.pairedInserts = next.ops;
      next.consumed = true;
    }
  }
  return runs;
}

/** A removed bar whose content reappears verbatim elsewhere is a move, not a rewrite. */
function markMoves(removed: BarChange[], added: BarChange[]): void {
  const addedByLine = new Map<string, BarChange[]>();
  for (const change of added) {
    if (change.afterLine === null) continue;
    const key = change.afterLine;
    const bucket = addedByLine.get(key);
    if (bucket) bucket.push(change);
    else addedByLine.set(key, [change]);
  }

  for (let i = 0; i < removed.length; i++) {
    const change = removed[i]!;
    if (change.beforeLine === null) continue;
    const bucket = addedByLine.get(change.beforeLine);
    const match = bucket?.shift();
    if (!match) continue;
    const index = added.indexOf(match);
    if (index >= 0) added.splice(index, 1);
    removed[i] = {
      ...change,
      kind: 'moved',
      afterIndex: match.afterIndex,
      afterLine: match.afterLine,
      summary: `bar moved to position ${(match.afterIndex ?? 0) + 1}`
    };
  }
}

function compareBarChanges(a: BarChange, b: BarChange): number {
  const aKey = a.afterIndex ?? a.beforeIndex ?? 0;
  const bKey = b.afterIndex ?? b.beforeIndex ?? 0;
  return aKey - bKey;
}

function simpleBar(
  kind: ChangeKind,
  beforeIndex: number | null,
  afterIndex: number | null,
  beforeLine: string | null,
  afterLine: string | null
): BarChange {
  return {
    kind,
    beforeIndex,
    afterIndex,
    beforeLine,
    afterLine,
    attrs: [],
    voices: [],
    summary: kind === 'added' ? 'bar added' : 'bar removed'
  };
}

// ---------------------------------------------------------------------------
// Bar level
// ---------------------------------------------------------------------------

function buildModifiedBar(
  beforeIndex: number,
  afterIndex: number,
  beforeLine: string,
  afterLine: string
): BarChange {
  const beforeBar = parseBarLine(beforeLine);
  const afterBar = parseBarLine(afterLine);
  const attrs = diffAttrs(beforeBar, afterBar);
  const voices = diffVoices(beforeBar, afterBar);

  const parts: string[] = [...attrs];
  let noteChanges = 0;
  for (const voice of voices) {
    for (const beat of voice.beats) noteChanges += Math.max(1, beat.notes.length);
  }
  if (noteChanges > 0) {
    parts.push(`${noteChanges} note change${noteChanges === 1 ? '' : 's'}`);
  }

  return {
    kind: 'modified',
    beforeIndex,
    afterIndex,
    beforeLine,
    afterLine,
    attrs,
    voices,
    summary: parts.length > 0 ? parts.join(', ') : 'bar changed'
  };
}

function diffAttrs(before: ParsedBar, after: ParsedBar): string[] {
  const beforeMap = attrMap(before.attrs);
  const afterMap = attrMap(after.attrs);
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: string[] = [];
  for (const key of [...keys].sort()) {
    const a = beforeMap.get(key);
    const b = afterMap.get(key);
    if (a === b) continue;
    if (a === undefined) changes.push(`added ${describeBarAttr(b!)}`);
    else if (b === undefined) changes.push(`removed ${describeBarAttr(a)}`);
    else changes.push(`${describeBarAttr(a)} → ${describeBarAttr(b)}`);
  }
  return changes;
}

function attrMap(attrs: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const attr of attrs) {
    const key = attr.split('=')[0] ?? attr;
    map.set(key, attr);
  }
  return map;
}

function diffVoices(before: ParsedBar, after: ParsedBar): VoiceChange[] {
  const labels = new Set([
    ...before.voices.map(voice => voice.label),
    ...after.voices.map(voice => voice.label)
  ]);
  const result: VoiceChange[] = [];
  for (const label of [...labels].sort()) {
    const beforeVoice = before.voices.find(voice => voice.label === label);
    const afterVoice = after.voices.find(voice => voice.label === label);
    const beats = diffBeats(beforeVoice, afterVoice);
    if (beats.length > 0) result.push({ label, beats });
  }
  return result;
}

function diffBeats(
  before: ParsedVoice | undefined,
  after: ParsedVoice | undefined
): BeatChange[] {
  const beforeBeats = before?.beats ?? [];
  const afterBeats = after?.beats ?? [];
  const ops = diffLines(
    beforeBeats.map(beat => beat.raw),
    afterBeats.map(beat => beat.raw)
  );
  const runs = groupRuns(ops);

  const changes: BeatChange[] = [];
  for (const run of runs) {
    if (run.kind === 'equal') continue;
    if (run.kind === 'delete') {
      const inserts = run.pairedInserts ?? [];
      const paired = Math.min(run.ops.length, inserts.length);
      for (let i = 0; i < paired; i++) {
        const b = beforeBeats[run.ops[i]!.beforeIndex!]!;
        const a = afterBeats[inserts[i]!.afterIndex!]!;
        changes.push(buildBeatChange(run.ops[i]!.beforeIndex!, inserts[i]!.afterIndex!, b, a));
      }
      for (let i = paired; i < run.ops.length; i++) {
        const index = run.ops[i]!.beforeIndex!;
        const beat = beforeBeats[index]!;
        changes.push({
          kind: 'removed',
          beforeIndex: index,
          afterIndex: null,
          before: beat,
          after: null,
          notes: [],
          description: `removed ${describeBeat(beat)}`
        });
      }
      for (let i = paired; i < inserts.length; i++) {
        const index = inserts[i]!.afterIndex!;
        const beat = afterBeats[index]!;
        changes.push({
          kind: 'added',
          beforeIndex: null,
          afterIndex: index,
          before: null,
          after: beat,
          notes: [],
          description: `added ${describeBeat(beat)}`
        });
      }
    } else if (run.kind === 'insert' && !run.consumed) {
      for (const op of run.ops) {
        const index = op.afterIndex!;
        const beat = afterBeats[index]!;
        changes.push({
          kind: 'added',
          beforeIndex: null,
          afterIndex: index,
          before: null,
          after: beat,
          notes: [],
          description: `added ${describeBeat(beat)}`
        });
      }
    }
  }
  return changes;
}

function buildBeatChange(
  beforeIndex: number,
  afterIndex: number,
  before: ParsedBeat,
  after: ParsedBeat
): BeatChange {
  const parts: string[] = [];
  if (before.duration !== after.duration || before.dots !== after.dots) {
    parts.push(
      `${durationName(before.duration, before.dots)} → ${durationName(after.duration, after.dots)}`
    );
  }
  if (before.tuplet !== after.tuplet) {
    parts.push(`tuplet ${before.tuplet ?? 'none'} → ${after.tuplet ?? 'none'}`);
  }
  if (before.isRest !== after.isRest) {
    parts.push(after.isRest ? 'became a rest' : 'rest became notes');
  }
  for (const description of diffFlagSets(before.flags, after.flags, describeBeatFlag)) {
    parts.push(description);
  }

  const notes = diffNotes(before.notes, after.notes);
  for (const note of notes) parts.push(note.description);

  return {
    kind: 'modified',
    beforeIndex,
    afterIndex,
    before,
    after,
    notes,
    description: parts.length > 0 ? parts.join('; ') : 'beat changed'
  };
}

function diffNotes(
  before: readonly ParsedNote[],
  after: readonly ParsedNote[]
): NoteChange[] {
  const changes: NoteChange[] = [];
  const afterByString = new Map<number | null, ParsedNote>();
  for (const note of after) afterByString.set(note.string, note);
  const beforeByString = new Map<number | null, ParsedNote>();
  for (const note of before) beforeByString.set(note.string, note);

  for (const beforeNote of before) {
    const afterNote = afterByString.get(beforeNote.string);
    if (!afterNote) {
      changes.push({
        kind: 'removed',
        before: beforeNote,
        after: null,
        description: `removed ${noteLabel(beforeNote)}`
      });
      continue;
    }
    if (beforeNote.raw === afterNote.raw) continue;
    const parts: string[] = [];
    if (beforeNote.fret !== afterNote.fret) {
      parts.push(
        `string ${afterNote.string}: fret ${beforeNote.fret} → ${afterNote.fret}`
      );
    }
    for (const description of diffFlagSets(
      beforeNote.flags,
      afterNote.flags,
      describeNoteFlag
    )) {
      parts.push(`string ${afterNote.string}: ${description}`);
    }
    changes.push({
      kind: 'modified',
      before: beforeNote,
      after: afterNote,
      description: parts.length > 0 ? parts.join('; ') : `string ${afterNote.string} changed`
    });
  }

  for (const afterNote of after) {
    if (beforeByString.has(afterNote.string)) continue;
    changes.push({
      kind: 'added',
      before: null,
      after: afterNote,
      description: `added ${noteLabel(afterNote)}`
    });
  }
  return changes;
}

function diffFlagSets(
  before: string,
  after: string,
  describe: (flag: Flag) => string
): string[] {
  const beforeFlags = new Map<string, Flag>();
  for (const flag of scanFlags(before)) beforeFlags.set(flag.key, flag);
  const afterFlags = new Map<string, Flag>();
  for (const flag of scanFlags(after)) afterFlags.set(flag.key, flag);

  const descriptions: string[] = [];
  for (const [key, flag] of [...afterFlags].sort(([a], [b]) => a.localeCompare(b))) {
    const previous = beforeFlags.get(key);
    if (!previous) descriptions.push(`added ${describe(flag)}`);
    else if (previous.arg !== flag.arg) {
      descriptions.push(`${describe(previous)} → ${describe(flag)}`);
    }
  }
  for (const [key, flag] of [...beforeFlags].sort(([a], [b]) => a.localeCompare(b))) {
    if (!afterFlags.has(key)) descriptions.push(`removed ${describe(flag)}`);
  }
  return descriptions;
}

function noteLabel(note: ParsedNote): string {
  if (note.percussion !== null) return `percussion ${note.percussion}`;
  return `string ${note.string} fret ${note.fret}`;
}

function describeBeat(beat: ParsedBeat): string {
  if (beat.isRest) return `${durationName(beat.duration, beat.dots)} rest`;
  const notes = beat.notes.map(noteLabel).join(', ');
  return `${durationName(beat.duration, beat.dots)} (${notes})`;
}
