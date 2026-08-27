/**
 * Turns canonical flag soup into the words a guitarist would use.
 * Everything the diff shows a human comes through here.
 */

export interface Flag {
  readonly key: string;
  readonly arg: string;
  readonly raw: string;
}

const FLAG_PATTERN = /([A-Za-z.])(\d*(?::[-\d.]+)?)(\([^)]*\))?("(?:[^"\\]|\\.)*")?/g;

export function scanFlags(flags: string): Flag[] {
  const result: Flag[] = [];
  FLAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = FLAG_PATTERN.exec(flags);
  while (match !== null) {
    const [raw, key, numeric, paren, quoted] = match;
    if (raw.length === 0) break;
    result.push({
      key: key ?? '',
      arg: `${numeric ?? ''}${paren ?? ''}${quoted ?? ''}`,
      raw
    });
    match = FLAG_PATTERN.exec(flags);
  }
  return result;
}

const DURATION_NAMES = new Map<number, string>([
  [-4, 'quadruple whole'],
  [-2, 'double whole'],
  [1, 'whole'],
  [2, 'half'],
  [4, 'quarter'],
  [8, 'eighth'],
  [16, 'sixteenth'],
  [32, 'thirty-second'],
  [64, 'sixty-fourth'],
  [128, '128th'],
  [256, '256th']
]);

export function durationName(duration: number, dots = 0): string {
  const base = DURATION_NAMES.get(duration) ?? `1/${duration}`;
  if (dots === 1) return `dotted ${base}`;
  if (dots === 2) return `double-dotted ${base}`;
  if (dots > 2) return `${dots}-dotted ${base}`;
  return base;
}

const HARMONIC_NAMES = ['', 'natural', 'artificial', 'pinch', 'tap', 'semi', 'feedback'];
const SLIDE_IN_NAMES = ['', 'slide in from below', 'slide in from above'];
const SLIDE_OUT_NAMES = [
  '',
  'shift slide',
  'legato slide',
  'slide out upwards',
  'slide out downwards',
  'pick slide down',
  'pick slide up'
];
const BEND_NAMES = [
  '',
  'custom bend',
  'bend',
  'release',
  'bend/release',
  'hold bend',
  'pre-bend',
  'pre-bend + bend',
  'pre-bend + release'
];
const BRUSH_NAMES = ['', 'brush up', 'brush down', 'arpeggio up', 'arpeggio down'];
const VIBRATO_NAMES = ['', 'slight vibrato', 'wide vibrato'];

function indexed(names: readonly string[], arg: string, fallback: string): string {
  const value = Number.parseInt(arg, 10);
  if (!Number.isFinite(value)) return fallback;
  return names[value] ?? fallback;
}

export function describeNoteFlag(flag: Flag): string {
  switch (flag.key) {
    case 'x': return 'dead note';
    case 'G': return 'ghost note';
    case 'T': return 'tie';
    case 'h': return 'hammer-on / pull-off';
    case 'k': return 'left-hand tap';
    case 'L': return 'let ring';
    case 'P': return 'palm mute';
    case '.': return 'staccato';
    case 'v': return indexed(VIBRATO_NAMES, flag.arg, 'vibrato');
    case 'H': return `${indexed(HARMONIC_NAMES, flag.arg, '')} harmonic`.trim();
    case 'i': return indexed(SLIDE_IN_NAMES, flag.arg, 'slide in');
    case 'o': return indexed(SLIDE_OUT_NAMES, flag.arg, 'slide out');
    case 'b': return indexed(BEND_NAMES, flag.arg, 'bend');
    case 'f': return `left-hand finger ${flag.arg}`;
    case 'g': return `right-hand finger ${flag.arg}`;
    case 't': return 'trill';
    case 'n': return 'ornament';
    case 'a': return 'accent';
    case 'd': return 'dynamics';
    case 'p': return 'duration';
    case 'I': return 'hidden';
    default: return flag.raw;
  }
}

export function describeBeatFlag(flag: Flag): string {
  switch (flag.key) {
    case 'P': return 'palm mute';
    case 'L': return 'let ring';
    case 'S': return 'slap';
    case 'O': return 'pop';
    case 'T': return 'tap';
    case 'Z': return 'slashed';
    case 'D': return 'dead slap';
    case 'V': return indexed(VIBRATO_NAMES, flag.arg, 'vibrato');
    case 'B': return indexed(BRUSH_NAMES, flag.arg, 'brush');
    case 'F': return 'fade';
    case 'K': return 'pick stroke';
    case 'W': return 'whammy bar';
    case 'x': return `text ${unquote(flag.arg)}`;
    case 'y': return `lyrics ${unquote(flag.arg)}`;
    case 'c': return `chord ${unquote(flag.arg)}`;
    default: return flag.raw;
  }
}

export function describeBarAttr(attr: string): string {
  const [key, ...rest] = attr.split('=');
  const value = rest.join('=');
  switch (key) {
    case 'ts': return `time signature ${value}`;
    case 'tempo': return `tempo ${value}`;
    case 'key': return `key signature ${value}`;
    case 'tf': return `triplet feel ${value}`;
    case 'section': return `section ${unquote(value)}`;
    case 'repeat-start': return 'repeat start';
    case 'repeat-end': return `repeat ${value} times`;
    case 'alt': return `alternate ending ${value}`;
    case 'double-bar': return 'double bar line';
    case 'free-time': return 'free time';
    case 'anacrusis': return 'pickup bar';
    default: return attr;
  }
}

export function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  return value
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
