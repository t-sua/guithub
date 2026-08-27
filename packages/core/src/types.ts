/**
 * Canonical representation types.
 *
 * The canonical form is the derived, deterministic text projection of a Guitar Pro
 * score that git operates on. The original binary remains the source of truth; this
 * exists so that `git diff` and `git blame` can work at the granularity of a single bar.
 */

/** Bumped whenever the canonical grammar changes in a way that alters output bytes. */
export const CANONICAL_FORMAT_VERSION = 1;

export interface CanonicalTrack {
  /** Repo-relative path, e.g. `tracks/01-guitar-1.tab`. */
  readonly path: string;
  /** Track name as authored in Guitar Pro. */
  readonly name: string;
  /** Zero-based index within the score. */
  readonly index: number;
  /**
   * The bar lines. Exactly one entry per bar, in order. Never contains `\n`.
   * Line N of the written file corresponds to bar N (1-based), with no header offset.
   */
  readonly lines: readonly string[];
}

export interface CanonicalSong {
  /** Contents of `song.json`, already serialised deterministically. */
  readonly songJson: string;
  /**
   * Contents of `structure.tab`: one line per bar describing time signature, tempo,
   * key, sections and repeats. Song-level properties live here rather than in the
   * track files so that track lines stay pure musical content.
   */
  readonly structure: readonly string[];
  /** One entry per track, in score order. */
  readonly tracks: readonly CanonicalTrack[];
}

/** Repo-relative path of the song structure file. */
export const STRUCTURE_PATH = 'structure.tab';

/** Metadata projected into `song.json`. Field order here defines serialisation order. */
export interface SongMetadata {
  readonly tabvc: number;
  readonly title: string;
  readonly subTitle: string;
  readonly artist: string;
  readonly album: string;
  readonly words: string;
  readonly music: string;
  readonly copyright: string;
  readonly tempo: number;
  readonly tempoLabel: string;
  readonly barCount: number;
  readonly tracks: readonly TrackMetadata[];
}

export interface TrackMetadata {
  readonly index: number;
  readonly name: string;
  readonly shortName: string;
  readonly path: string;
  readonly barCount: number;
  /** MIDI note numbers, high string first, as Guitar Pro stores them. Empty for percussion. */
  readonly tuning: readonly number[];
  readonly tuningName: string;
  readonly capo: number;
  readonly midiProgram: number;
  readonly midiChannel: number;
  readonly isPercussion: boolean;
  readonly stringCount: number;
}
