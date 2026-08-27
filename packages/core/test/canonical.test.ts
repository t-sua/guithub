import { describe, expect, it } from 'vitest';
import {
  canonicalizeScore,
  barFileContent,
  parseTrackFile,
  CANONICAL_FORMAT_VERSION
} from '../src/index.js';
import { GP_FIXTURES, exportToGp, loadFixture, reimport } from './helpers.js';

describe('canonicalizeScore', () => {
  it.each(GP_FIXTURES)('is deterministic for %s', name => {
    const score = loadFixture(name);
    const first = canonicalizeScore(score);
    const second = canonicalizeScore(score);
    expect(second.songJson).toBe(first.songJson);
    expect(second.structure).toEqual(first.structure);
    expect(second.tracks).toEqual(first.tracks);
  });

  it.each(GP_FIXTURES)('is stable across a fresh parse of %s', name => {
    // Parsing the same bytes twice must produce the same canonical form. This is the
    // invariant the upload pipeline verifies before it commits anything.
    const first = canonicalizeScore(loadFixture(name));
    const second = canonicalizeScore(loadFixture(name));
    expect(second.songJson).toBe(first.songJson);
    expect(second.structure).toEqual(first.structure);
    expect(second.tracks.map(t => t.lines)).toEqual(first.tracks.map(t => t.lines));
  });

  it.each(GP_FIXTURES)('survives a Guitar Pro export round trip for %s', name => {
    // canonical(x) must equal canonical(import(export(x))). If this breaks, a version
    // could change identity purely by passing through Guitar Pro.
    const score = loadFixture(name);
    const before = canonicalizeScore(score);
    const after = canonicalizeScore(reimport(exportToGp(score)));
    expect(after.structure).toEqual(before.structure);
    expect(after.tracks.map(t => t.lines)).toEqual(before.tracks.map(t => t.lines));
  });

  it.each(GP_FIXTURES)('emits exactly one line per bar for %s', name => {
    const score = loadFixture(name);
    const canonical = canonicalizeScore(score);
    const barCount = score.masterBars.length;
    expect(canonical.structure).toHaveLength(barCount);
    for (const track of canonical.tracks) {
      expect(track.lines, `${track.path} bar count`).toHaveLength(barCount);
      for (const line of track.lines) {
        expect(line).not.toContain('\n');
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  it('records the format version in song.json', () => {
    const canonical = canonicalizeScore(loadFixture('song-a.gp'));
    const metadata = JSON.parse(canonical.songJson) as { tabvc: number };
    expect(metadata.tabvc).toBe(CANONICAL_FORMAT_VERSION);
  });

  it('numbers strings the way a guitarist does', () => {
    // song-a bar 1 is an open-position riff on the low E (6th) and A (5th) strings.
    const canonical = canonicalizeScore(loadFixture('song-a.gp'));
    expect(canonical.tracks[0]?.lines[0]).toBe('v0: 8[6/3] 8[6/5] 8[5/3h] 8[5/5]');
  });

  it('keeps song structure out of the track files', () => {
    // Tempo, time signature and key belong to the song, not to any one track: a track
    // line must never change because someone changed the tempo.
    const canonical = canonicalizeScore(loadFixture('song-b-complex.gp'));
    expect(canonical.structure[0]).toContain('tempo=90');
    for (const track of canonical.tracks) {
      for (const line of track.lines) {
        expect(line).not.toContain('tempo=');
        expect(line).not.toContain('ts=');
      }
    }
  });

  it('never embeds a bar number in a bar line', () => {
    // A positional id would make inserting one bar rewrite every following line.
    const canonical = canonicalizeScore(loadFixture('song-a.gp'));
    for (const track of canonical.tracks) {
      for (const line of track.lines) {
        expect(line).not.toMatch(/^b\d+/);
      }
    }
  });

  it('round-trips file content through parseTrackFile', () => {
    const canonical = canonicalizeScore(loadFixture('song-b-complex.gp'));
    for (const track of canonical.tracks) {
      const content = barFileContent(track.lines);
      expect(content.endsWith('\n')).toBe(true);
      expect(parseTrackFile(content)).toEqual([...track.lines]);
    }
    expect(parseTrackFile('')).toEqual([]);
  });

  it('gives every track a distinct file path', () => {
    const canonical = canonicalizeScore(loadFixture('song-a.gp'));
    const paths = canonical.tracks.map(track => track.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(['tracks/01-guitar-1.tab', 'tracks/02-bass.tab']);
  });
});
