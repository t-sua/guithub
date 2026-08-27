/**
 * Tokenizer for canonical bar lines.
 *
 * The grammar is the one emitted by `canonical.ts`:
 *
 *   ts=4/4 section="Chorus" | v0: 8[6/3h 5/3] 4r 4[5/7b2(0,0;60,4)]P
 *
 * Splitting is bracket- and quote-aware so that a `|` inside a section name or a
 * space inside a chord never breaks a bar apart in the wrong place.
 */

export interface ParsedBar {
  readonly attrs: readonly string[];
  readonly voices: readonly ParsedVoice[];
}

export interface ParsedVoice {
  readonly label: string;
  readonly beats: readonly ParsedBeat[];
}

export interface ParsedBeat {
  readonly raw: string;
  readonly duration: number;
  readonly dots: number;
  readonly tuplet: string | null;
  readonly isRest: boolean;
  readonly notes: readonly ParsedNote[];
  readonly flags: string;
}

export interface ParsedNote {
  readonly raw: string;
  /** Display string number (6 = low E on a 6-string), or null for percussion. */
  readonly string: number | null;
  readonly fret: number | null;
  /** Percussion articulation id, when the note came from a percussion staff. */
  readonly percussion: number | null;
  readonly flags: string;
}

/** Splits on `separator` at nesting depth zero, ignoring quoted regions. */
export function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      current += ch;
      if (ch === '\\') {
        const next = input[i + 1];
        if (next !== undefined) {
          current += next;
          i++;
        }
      } else if (ch === '"') {
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

const BEAT_PATTERN = /^(-?\d+)(\.*)(?:t(\d+:\d+))?(?:(r|_)|\[([^\]]*)\])(.*)$/;
const NOTE_PATTERN = /^(?:(\d+)\/(\d+)|!(\d+))(.*)$/;

const VOICE_LABEL = /^(?:s\d+)?v\d+$/;

/**
 * Parses one canonical bar line. A segment is a voice when its label looks like
 * `v0` or `s1v0`; anything else is treated as bar attributes. That single rule
 * covers structure lines (attributes only) and track lines (voices, with an
 * optional leading attribute segment) without needing to know which file it came from.
 */
export function parseBarLine(line: string): ParsedBar {
  const attrs: string[] = [];
  const voices: ParsedVoice[] = [];

  for (const segment of splitTopLevel(line, '|')) {
    const trimmed = segment.trim();
    if (trimmed.length === 0 || trimmed === '-') continue;
    const colon = trimmed.indexOf(':');
    const label = colon < 0 ? '' : trimmed.slice(0, colon).trim();
    if (colon >= 0 && VOICE_LABEL.test(label)) {
      const body = trimmed.slice(colon + 1).trim();
      voices.push({ label, beats: body === '-' ? [] : parseBeats(body) });
    } else {
      for (const token of splitTopLevel(trimmed, ' ')) {
        if (token.length > 0) attrs.push(token);
      }
    }
  }

  return { attrs, voices };
}

function parseBeats(body: string): ParsedBeat[] {
  const beats: ParsedBeat[] = [];
  for (const raw of splitTopLevel(body, ' ')) {
    if (raw.length === 0) continue;
    beats.push(parseBeat(raw));
  }
  return beats;
}

export function parseBeat(raw: string): ParsedBeat {
  const match = BEAT_PATTERN.exec(raw);
  if (!match) {
    return { raw, duration: 0, dots: 0, tuplet: null, isRest: true, notes: [], flags: '' };
  }
  const [, duration, dots, tuplet, rest, noteBody, flags] = match;
  const notes: ParsedNote[] = [];
  if (noteBody !== undefined && noteBody.length > 0) {
    for (const noteRaw of splitTopLevel(noteBody, ' ')) {
      if (noteRaw.length > 0) notes.push(parseNote(noteRaw));
    }
  }
  return {
    raw,
    duration: Number(duration),
    dots: dots ? dots.length : 0,
    tuplet: tuplet ?? null,
    isRest: rest !== undefined,
    notes,
    flags: flags ?? ''
  };
}

export function parseNote(raw: string): ParsedNote {
  const match = NOTE_PATTERN.exec(raw);
  if (!match) return { raw, string: null, fret: null, percussion: null, flags: '' };
  const [, stringNumber, fret, percussion, flags] = match;
  return {
    raw,
    string: stringNumber === undefined ? null : Number(stringNumber),
    fret: fret === undefined ? null : Number(fret),
    percussion: percussion === undefined ? null : Number(percussion),
    flags: flags ?? ''
  };
}
