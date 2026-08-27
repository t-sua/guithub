import * as alphaTab from '@coderline/alphatab';
import {
  CANONICAL_FORMAT_VERSION,
  type CanonicalSong,
  type CanonicalTrack,
  type SongMetadata,
  type TrackMetadata
} from './types.js';

type Score = alphaTab.model.Score;
type Track = alphaTab.model.Track;
type Bar = alphaTab.model.Bar;
type MasterBar = alphaTab.model.MasterBar;
type Beat = alphaTab.model.Beat;
type Note = alphaTab.model.Note;

/**
 * Canonicalisation must be a pure, total function of the parsed score: the same
 * `Score` must always produce byte-identical output. Everything in this module
 * therefore iterates in explicit index order, sorts on stable keys, and formats
 * numbers without relying on locale or float printing.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function canonicalizeScore(score: Score): CanonicalSong {
  const tracks: CanonicalTrack[] = [];
  const trackMeta: TrackMetadata[] = [];

  const usedPaths = new Set<string>();
  for (let t = 0; t < score.tracks.length; t++) {
    const track = score.tracks[t];
    if (!track) continue;
    const path = uniquePath(trackPath(t, track.name), usedPaths);
    tracks.push({
      path,
      name: track.name,
      index: t,
      lines: renderTrackLines(score, track)
    });
    trackMeta.push(describeTrack(t, track, path));
  }

  const metadata: SongMetadata = {
    tabvc: CANONICAL_FORMAT_VERSION,
    title: score.title,
    subTitle: score.subTitle,
    artist: score.artist,
    album: score.album,
    words: score.words,
    music: score.music,
    copyright: score.copyright,
    tempo: score.tempo,
    tempoLabel: score.tempoLabel,
    barCount: score.masterBars.length,
    tracks: trackMeta
  };

  return {
    songJson: `${JSON.stringify(metadata, null, 2)}\n`,
    structure: renderStructureLines(score),
    tracks
  };
}

/** Joins bar lines into the exact bytes written to disk. */
export function barFileContent(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** Joins a track's bar lines into the exact bytes written to disk. */
export function trackFileContent(track: CanonicalTrack): string {
  return barFileContent(track.lines);
}

/** Splits a bar file back into lines. Inverse of {@link barFileContent}. */
export function parseTrackFile(content: string): string[] {
  if (content === '') return [];
  const withoutTrailing = content.endsWith('\n') ? content.slice(0, -1) : content;
  return withoutTrailing.split('\n');
}

// ---------------------------------------------------------------------------
// Track / metadata
// ---------------------------------------------------------------------------

function describeTrack(index: number, track: Track, path: string): TrackMetadata {
  const staff = track.staves[0];
  const tuning = staff ? [...staff.stringTuning.tunings] : [];
  return {
    index,
    name: track.name,
    shortName: track.shortName,
    path,
    barCount: staff ? staff.bars.length : 0,
    tuning,
    tuningName: staff?.stringTuning.name ?? '',
    capo: staff?.capo ?? 0,
    midiProgram: track.playbackInfo.program,
    midiChannel: track.playbackInfo.primaryChannel,
    isPercussion: staff?.isPercussion ?? false,
    stringCount: tuning.length
  };
}

function trackPath(index: number, name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'track';
  return `tracks/${String(index + 1).padStart(2, '0')}-${slug}.tab`;
}

function uniquePath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  for (let n = 2; ; n++) {
    const candidate = path.replace(/\.tab$/, `-${n}.tab`);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

// ---------------------------------------------------------------------------
// Bar lines
// ---------------------------------------------------------------------------

/**
 * Musical state that persists from bar to bar. Attributes are only emitted when
 * they change, so that (for example) altering the global time signature rewrites
 * one line rather than every line in the song.
 */
/**
 * Musical state that persists from bar to bar. Attributes are only emitted when
 * they change, so that altering the global tempo rewrites one line rather than
 * every line in the song.
 */
interface BarContext {
  timeSignature: string;
  keySignature: number;
  tripletFeel: number;
  tempo: number;
}

function newContext(): BarContext {
  return {
    timeSignature: '',
    keySignature: Number.NaN,
    tripletFeel: Number.NaN,
    tempo: Number.NaN
  };
}

/**
 * Song structure: time signatures, tempo, key, sections and repeats. These are
 * properties of the score as a whole rather than of any one track, and keeping them
 * out of the track files is what lets a track line be pure musical content. A bar
 * that changes nothing structurally is written as `-`.
 */
function renderStructureLines(score: Score): string[] {
  const context = newContext();
  const referenceStaff = score.tracks[0]?.staves[0];
  const lines: string[] = [];

  for (let b = 0; b < score.masterBars.length; b++) {
    const masterBar = score.masterBars[b];
    if (!masterBar) continue;
    const attrs: string[] = [];

    const timeSignature = `${masterBar.timeSignatureNumerator}/${masterBar.timeSignatureDenominator}`;
    if (timeSignature !== context.timeSignature) {
      attrs.push(`ts=${timeSignature}`);
      context.timeSignature = timeSignature;
    }

    const tempo = barTempo(masterBar);
    if (tempo !== null && tempo !== context.tempo) {
      attrs.push(`tempo=${formatNumber(tempo)}`);
      context.tempo = tempo;
    }

    const keySignature = referenceStaff?.bars[b]?.keySignature;
    if (keySignature !== undefined && keySignature !== context.keySignature) {
      attrs.push(`key=${keySignature}`);
      context.keySignature = keySignature;
    }

    if (masterBar.tripletFeel !== context.tripletFeel) {
      if (masterBar.tripletFeel !== 0 || !Number.isNaN(context.tripletFeel)) {
        attrs.push(`tf=${masterBar.tripletFeel}`);
      }
      context.tripletFeel = masterBar.tripletFeel;
    }

    if (masterBar.section) attrs.push(`section=${quote(sectionLabel(masterBar.section))}`);
    if (masterBar.isRepeatStart) attrs.push('repeat-start');
    if (masterBar.repeatCount > 1) attrs.push(`repeat-end=${masterBar.repeatCount}`);
    if (masterBar.alternateEndings !== 0) attrs.push(`alt=${masterBar.alternateEndings}`);
    if (masterBar.isDoubleBar) attrs.push('double-bar');
    if (masterBar.isFreeTime) attrs.push('free-time');
    if (masterBar.isAnacrusis) attrs.push('anacrusis');

    lines.push(attrs.length > 0 ? attrs.join(' ') : '-');
  }
  return lines;
}

/**
 * Track content: notes only. No bar numbers and no structural attributes, so that
 * inserting a bar leaves every other line byte-identical. That is what keeps move
 * detection exact and, more importantly, keeps `git blame` attributing a bar to the
 * person who actually wrote those notes rather than to whoever last changed the tempo.
 */
function renderTrackLines(score: Score, track: Track): string[] {
  const barCount = score.masterBars.length;
  const referenceStaff = score.tracks[0]?.staves[0];
  const keyContext = { keySignature: Number.NaN };
  const lines: string[] = [];

  for (let b = 0; b < barCount; b++) {
    const attrs: string[] = [];

    // Key signature normally matches the rest of the score and is recorded once in
    // structure.tab. Only a track that disagrees carries its own marker.
    const ownKey = track.staves[0]?.bars[b]?.keySignature;
    const referenceKey = referenceStaff?.bars[b]?.keySignature;
    if (ownKey !== undefined && ownKey !== referenceKey) {
      if (ownKey !== keyContext.keySignature) {
        attrs.push(`key=${ownKey}`);
        keyContext.keySignature = ownKey;
      }
    } else if (ownKey !== undefined) {
      keyContext.keySignature = Number.NaN;
    }

    const sections: string[] = [];
    const multiStaff = track.staves.length > 1;
    for (let s = 0; s < track.staves.length; s++) {
      const staff = track.staves[s];
      const bar = staff?.bars[b];
      if (!bar) continue;
      for (let v = 0; v < bar.voices.length; v++) {
        const voice = bar.voices[v];
        if (!voice) continue;
        // Keep voice 0 always so every bar has a section; drop silent extra voices
        // so an unused voice slot never pollutes the diff.
        if (v > 0 && voice.isEmpty) continue;
        const label = multiStaff ? `s${s}v${v}` : `v${v}`;
        sections.push(`${label}: ${renderBeats(bar, voice.beats)}`);
      }
    }

    const body = sections.length > 0 ? sections.join(' | ') : 'v0: -';
    lines.push(attrs.length > 0 ? `${attrs.join(' ')} | ${body}` : body);
  }
  return lines;
}

function sectionLabel(section: alphaTab.model.Section): string {
  const marker = section.marker.trim();
  const text = section.text.trim();
  if (marker && text) return `${marker} ${text}`;
  return marker || text;
}

function barTempo(masterBar: MasterBar): number | null {
  let tempo: number | null = null;
  for (let i = 0; i < masterBar.tempoAutomations.length; i++) {
    const automation = masterBar.tempoAutomations[i];
    if (automation) tempo = automation.value;
  }
  return tempo;
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

function renderBeats(bar: Bar, beats: readonly Beat[]): string {
  if (beats.length === 0) return '-';
  const tokens: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (beat) tokens.push(renderBeat(bar, beat));
  }
  return tokens.join(' ');
}

function renderBeat(bar: Bar, beat: Beat): string {
  let token = String(beat.duration);
  token += '.'.repeat(Math.max(0, beat.dots));
  if (beat.tupletNumerator > 1 || beat.tupletDenominator > 1) {
    token += `t${beat.tupletNumerator}:${beat.tupletDenominator}`;
  }

  if (beat.notes.length === 0) {
    token += beat.isEmpty ? '_' : 'r';
  } else {
    const notes = [...beat.notes].sort(compareNotes);
    const rendered: string[] = [];
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note) rendered.push(renderNote(bar, note));
    }
    token += `[${rendered.join(' ')}]`;
  }

  token += beatFlags(beat);
  return token;
}

/** Stable ordering: by string, then fret, then percussion articulation. */
function compareNotes(a: Note, b: Note): number {
  if (a.string !== b.string) return a.string - b.string;
  if (a.fret !== b.fret) return a.fret - b.fret;
  return a.percussionArticulation - b.percussionArticulation;
}

function beatFlags(beat: Beat): string {
  let flags = '';
  if (beat.isPalmMute) flags += 'P';
  if (beat.isLetRing) flags += 'L';
  if (beat.slap) flags += 'S';
  if (beat.pop) flags += 'O';
  if (beat.tap) flags += 'T';
  if (beat.slashed) flags += 'Z';
  if (beat.deadSlapped) flags += 'D';
  if (beat.vibrato !== 0) flags += `V${beat.vibrato}`;
  if (beat.brushType !== 0) flags += `B${beat.brushType}`;
  if (beat.fade !== 0) flags += `F${beat.fade}`;
  if (beat.pickStroke !== 0) flags += `K${beat.pickStroke}`;
  if (beat.whammyBarType !== 0) {
    flags += `W${beat.whammyBarType}${renderPoints(beat.whammyBarPoints)}`;
  }
  if (beat.text) flags += `x${quote(beat.text)}`;
  if (beat.lyrics && beat.lyrics.length > 0) flags += `y${quote(beat.lyrics.join(' '))}`;
  if (beat.chordId) flags += `c${quote(beat.chordId)}`;
  return flags;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function renderNote(bar: Bar, note: Note): string {
  let token: string;
  if (bar.staff.isPercussion) {
    token = `!${note.percussionArticulation}`;
  } else {
    // alphaTab numbers strings with 1 = highest pitch. Guitar Pro, tab notation and
    // every musician call the low E of a 6-string the 6th string, so flip it: the
    // canonical files are meant to be readable by the people whose songs they are.
    const stringCount = bar.staff.stringTuning.tunings.length;
    const displayString = stringCount > 0 ? stringCount - note.string + 1 : note.string;
    token = `${displayString}/${note.fret}`;
  }

  if (note.isDead) token += 'x';
  if (note.isGhost) token += 'G';
  if (note.isTieDestination) token += 'T';
  if (note.isHammerPullOrigin) token += 'h';
  if (note.isLeftHandTapped) token += 'k';
  if (note.isLetRing) token += 'L';
  if (note.isPalmMute) token += 'P';
  if (note.isStaccato) token += '.';
  if (note.vibrato !== 0) token += `v${note.vibrato}`;
  if (note.harmonicType !== 0) {
    token += `H${note.harmonicType}`;
    if (note.harmonicValue !== 0) token += `:${formatNumber(note.harmonicValue)}`;
  }
  if (note.slideInType !== 0) token += `i${note.slideInType}`;
  if (note.slideOutType !== 0) token += `o${note.slideOutType}`;
  if (note.bendType !== 0) token += `b${note.bendType}${renderPoints(note.bendPoints)}`;
  if (note.leftHandFinger !== -2) token += `f${note.leftHandFinger}`;
  if (note.rightHandFinger !== -2) token += `g${note.rightHandFinger}`;
  if (note.trillValue >= 0) token += `t${note.trillValue}:${note.trillSpeed}`;
  if (note.ornament !== 0) token += `n${note.ornament}`;
  if (note.accentuated !== 0) token += `a${note.accentuated}`;
  if (note.dynamics !== 5) token += `d${note.dynamics}`;
  if (note.durationPercent !== 1) token += `p${formatNumber(note.durationPercent)}`;
  if (!note.isVisible) token += 'I';
  return token;
}

function renderPoints(points: alphaTab.model.BendPoint[] | null): string {
  if (!points || points.length === 0) return '';
  const sorted = [...points].sort((a, b) => a.offset - b.offset || a.value - b.value);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i];
    if (point) parts.push(`${formatNumber(point.offset)},${formatNumber(point.value)}`);
  }
  return `(${parts.join(';')})`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Formats a number without exponent notation or `-0`, so that canonical output
 * never varies for numerically equal values.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value === 0 ? 0 : value);
  const fixed = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '-0' ? '0' : fixed;
}

/** Quotes a string for embedding in a bar line; newlines are escaped away. */
export function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
