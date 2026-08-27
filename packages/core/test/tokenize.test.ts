import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  canonicalizeScore,
  parseBarLine,
  parseBeat,
  parseNote,
  splitTopLevel,
  scanFlags,
  durationName,
  unquote
} from '../src/index.js';
import { GP_FIXTURES, loadFixture } from './helpers.js';

describe('splitTopLevel', () => {
  it('ignores separators inside brackets, parens and quotes', () => {
    expect(splitTopLevel('a | b', '|')).toEqual(['a ', ' b']);
    expect(splitTopLevel('4[6/3 5/3] | v0', '|')).toEqual(['4[6/3 5/3] ', ' v0']);
    expect(splitTopLevel('5/7b2(0,0;60,4)', ',')).toEqual(['5/7b2(0,0;60,4)']);
    expect(splitTopLevel('section="Verse | Chorus" ts=4/4', '|')).toEqual([
      'section="Verse | Chorus" ts=4/4'
    ]);
  });

  it('handles escaped quotes', () => {
    expect(splitTopLevel('x="a\\"|b" y', '|')).toEqual(['x="a\\"|b" y']);
  });
});

describe('parseBarLine', () => {
  it('parses a track line with one voice', () => {
    const bar = parseBarLine('v0: 8[6/3h] 4r');
    expect(bar.attrs).toEqual([]);
    expect(bar.voices).toHaveLength(1);
    expect(bar.voices[0]?.label).toBe('v0');
    expect(bar.voices[0]?.beats).toHaveLength(2);
    expect(bar.voices[0]?.beats[1]?.isRest).toBe(true);
  });

  it('parses a structure line as attributes only', () => {
    const bar = parseBarLine('ts=4/4 tempo=132 section="Chorus" repeat-start');
    expect(bar.voices).toEqual([]);
    expect(bar.attrs).toEqual(['ts=4/4', 'tempo=132', 'section="Chorus"', 'repeat-start']);
  });

  it('parses an empty structure line', () => {
    expect(parseBarLine('-')).toEqual({ attrs: [], voices: [] });
  });

  it('parses multiple voices and staves', () => {
    const bar = parseBarLine('s0v0: 4[6/3] | s1v0: 4[5/5]');
    expect(bar.voices.map(voice => voice.label)).toEqual(['s0v0', 's1v0']);
  });

  it('separates a leading attribute segment from voices', () => {
    const bar = parseBarLine('key=3 | v0: 4[6/3]');
    expect(bar.attrs).toEqual(['key=3']);
    expect(bar.voices).toHaveLength(1);
  });
});

describe('parseBeat', () => {
  it('parses duration, dots and tuplets', () => {
    expect(parseBeat('4.[6/3]')).toMatchObject({ duration: 4, dots: 1, tuplet: null });
    expect(parseBeat('8t3:2[6/3]')).toMatchObject({ duration: 8, tuplet: '3:2' });
    expect(parseBeat('16..[6/3]')).toMatchObject({ duration: 16, dots: 2 });
  });

  it('parses rests and chords', () => {
    expect(parseBeat('4r')).toMatchObject({ isRest: true, notes: [] });
    expect(parseBeat('4[5/3 4/3 3/3]').notes).toHaveLength(3);
  });

  it('keeps beat flags separate from notes', () => {
    const beat = parseBeat('8[6/3P]PL');
    expect(beat.flags).toBe('PL');
    expect(beat.notes[0]?.flags).toBe('P');
  });
});

describe('parseNote', () => {
  it('parses string, fret and flags', () => {
    expect(parseNote('6/3')).toMatchObject({ string: 6, fret: 3, flags: '' });
    expect(parseNote('5/12H1:12')).toMatchObject({ string: 5, fret: 12, flags: 'H1:12' });
    expect(parseNote('5/7b2(0,0;60,4)')).toMatchObject({ string: 5, fret: 7 });
  });

  it('parses percussion notes', () => {
    expect(parseNote('!42')).toMatchObject({ percussion: 42, string: null, fret: null });
  });
});

describe('scanFlags', () => {
  it('splits flags into individual effects', () => {
    expect(scanFlags('PL').map(f => f.key)).toEqual(['P', 'L']);
    expect(scanFlags('H1:12').map(f => f.key)).toEqual(['H']);
    expect(scanFlags('b2(0,0;60,4)')[0]).toMatchObject({ key: 'b', arg: '2(0,0;60,4)' });
    expect(scanFlags('x"go loud"')[0]).toMatchObject({ key: 'x', arg: '"go loud"' });
  });
});

describe('round trip over the fixture corpus', () => {
  it.each(GP_FIXTURES)('re-parses every canonical line of %s', name => {
    const canonical = canonicalizeScore(loadFixture(name));
    for (const line of canonical.structure) {
      expect(() => parseBarLine(line)).not.toThrow();
    }
    for (const track of canonical.tracks) {
      for (const line of track.lines) {
        const bar = parseBarLine(line);
        expect(bar.voices.length).toBeGreaterThan(0);
        // Every beat must tokenize back to the exact text it came from, so the diff
        // can never silently misread a bar it is about to describe to a human.
        const rebuilt = bar.voices
          .map(voice =>
            voice.beats.length === 0
              ? `${voice.label}: -`
              : `${voice.label}: ${voice.beats.map(beat => beat.raw).join(' ')}`
          )
          .join(' | ');
        const expected = line.includes(' | v') || line.startsWith('v') ? line : line;
        expect(rebuilt).toBe(expected.replace(/^[^|]*\| (?=(?:s\d+)?v\d+:)/, ''));
      }
    }
  });
});

describe('helpers', () => {
  it('names durations the way musicians do', () => {
    expect(durationName(4)).toBe('quarter');
    expect(durationName(8, 1)).toBe('dotted eighth');
    expect(durationName(16, 2)).toBe('double-dotted sixteenth');
  });

  it('unquotes what quote produced', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        const escaped = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r\n|\r|\n/g, '\\n')
          .replace(/\t/g, '\\t');
        const normalised = value.replace(/\r\n|\r/g, '\n');
        expect(unquote(`"${escaped}"`)).toBe(normalised);
      })
    );
  });
});
