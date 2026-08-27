export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
}

export interface Song {
  id: string;
  slug: string;
  title: string;
  artist: string;
  createdAt: string;
  updatedAt: string;
  headCommit: string | null;
  versionCount: number;
  trackCount: number;
  barCount: number;
}

export interface Version {
  commit: string;
  shortCommit: string;
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
}

export interface TrackMetadata {
  index: number;
  name: string;
  shortName: string;
  path: string;
  barCount: number;
  tuning: number[];
  tuningName: string;
  capo: number;
  midiProgram: number;
  isPercussion: boolean;
  stringCount: number;
}

export interface SongMetadata {
  tabvc: number;
  title: string;
  subTitle: string;
  artist: string;
  album: string;
  tempo: number;
  barCount: number;
  tracks: TrackMetadata[];
}

export interface CanonicalSong {
  songJson: string;
  structure: string[];
  tracks: { path: string; name: string; index: number; lines: string[] }[];
}

export interface Provenance {
  originalFilename: string;
  originalBytes: number;
  originalSha256: string;
  uploadedAt: string;
  canonicalFormat: number;
}

export type ChangeKind = 'added' | 'removed' | 'modified' | 'moved';

export interface NoteChange {
  kind: ChangeKind;
  description: string;
}

export interface BeatChange {
  kind: ChangeKind;
  beforeIndex: number | null;
  afterIndex: number | null;
  notes: NoteChange[];
  description: string;
}

export interface VoiceChange {
  label: string;
  beats: BeatChange[];
}

export interface BarChange {
  kind: ChangeKind;
  beforeIndex: number | null;
  afterIndex: number | null;
  beforeLine: string | null;
  afterLine: string | null;
  attrs: string[];
  voices: VoiceChange[];
  summary: string;
}

export interface TrackDiff {
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'unchanged';
  name: string;
  previousName: string | null;
  path: string | null;
  previousPath: string | null;
  bars: BarChange[];
  barsAdded: number;
  barsRemoved: number;
  barsModified: number;
  barsMoved: number;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface SongDiff {
  metadata: FieldChange[];
  structure: BarChange[];
  tracks: TrackDiff[];
  hasChanges: boolean;
}

export interface BlameLine {
  bar: number;
  commit: string;
  shortCommit: string;
  authorName: string;
  authorEmail: string;
  date: string;
  summary: string;
  content: string;
}
