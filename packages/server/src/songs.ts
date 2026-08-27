import * as alphaTab from '@coderline/alphatab';
import {
  canonicalizeScore,
  barFileContent,
  parseTrackFile,
  STRUCTURE_PATH,
  type CanonicalSong,
  type CanonicalTrack,
  type SongMetadata
} from '@guithub/core';
import {
  commitTree,
  resolveRef,
  updateRef,
  writeBlob,
  writeTree,
  type CommitIdentity,
  type TreeEntry
} from './git.js';
import { listFilesAt, readFileAt, readTextAt } from './history.js';

export const MAIN_REF = 'refs/heads/main';
export const SONG_JSON = 'song.json';
export const VERSION_JSON = 'version.json';

/** Formats alphaTab can import. Anything else is rejected before it reaches storage. */
export const ACCEPTED_EXTENSIONS = [
  '.gp',
  '.gp3',
  '.gp4',
  '.gp5',
  '.gpx',
  '.musicxml',
  '.xml',
  '.mxl',
  '.cap',
  '.capx'
] as const;

// alphaTab logs import failures to the console. We surface those to the user as a
// clean UploadError instead, so keep the library quiet.
alphaTab.Logger.logLevel = alphaTab.LogLevel.None;

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/** Provenance for a single version, written alongside the music. */
export interface VersionProvenance {
  readonly originalFilename: string;
  readonly originalBytes: number;
  readonly originalSha256: string;
  readonly uploadedAt: string;
  readonly canonicalFormat: number;
}

export interface CommitVersionInput {
  readonly repoDir: string;
  readonly bytes: Buffer;
  readonly filename: string;
  readonly message: string;
  readonly author: CommitIdentity;
  readonly when?: Date;
}

export interface CommitVersionResult {
  readonly commit: string;
  readonly canonical: CanonicalSong;
  readonly metadata: SongMetadata;
  readonly originalPath: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot).toLowerCase();
}

export function parseScore(bytes: Buffer, filename: string): alphaTab.model.Score {
  const extension = extensionOf(filename);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new UploadError(
      `Unsupported file type "${extension || filename}". Accepted formats: ${ACCEPTED_EXTENSIONS.join(', ')}.`
    );
  }
  try {
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UploadError(
      `Could not read "${filename}" as a tab file. It may be corrupt or saved in an unsupported version. (${detail})`
    );
  }
}

// ---------------------------------------------------------------------------
// Committing a version
// ---------------------------------------------------------------------------

/**
 * Parses, canonicalises, verifies and commits one uploaded file.
 *
 * The verification step re-parses the exact bytes about to be stored and
 * re-canonicalises them, asserting the result is identical. Canonical output is the
 * basis of every diff and every blame line in the song's history, so a
 * nondeterministic canonicaliser would silently corrupt that history. Better to
 * refuse the upload.
 */
export async function commitVersion(input: CommitVersionInput): Promise<CommitVersionResult> {
  const { repoDir, bytes, filename, message, author } = input;
  const when = input.when ?? new Date();

  const score = parseScore(bytes, filename);
  const canonical = canonicalizeScore(score);

  const verification = canonicalizeScore(parseScore(bytes, filename));
  assertIdentical(canonical, verification);

  const originalPath = `original${extensionOf(filename)}`;
  const provenance: VersionProvenance = {
    originalFilename: filename,
    originalBytes: bytes.length,
    originalSha256: await sha256(bytes),
    uploadedAt: when.toISOString(),
    canonicalFormat: JSON.parse(canonical.songJson).tabvc as number
  };

  const files = new Map<string, Buffer>();
  files.set(SONG_JSON, Buffer.from(canonical.songJson, 'utf8'));
  files.set(VERSION_JSON, Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`, 'utf8'));
  files.set(STRUCTURE_PATH, Buffer.from(barFileContent(canonical.structure), 'utf8'));
  files.set(originalPath, bytes);
  for (const track of canonical.tracks) {
    files.set(track.path, Buffer.from(barFileContent(track.lines), 'utf8'));
  }

  const treeHash = await buildTree(repoDir, files);
  const parent = await resolveRef(repoDir, MAIN_REF);

  const commitMessage = message.trim().length > 0 ? message.trim() : 'Updated tab';
  const commit = await commitTree(
    repoDir,
    treeHash,
    parent ? [parent] : [],
    `${commitMessage}\n`,
    author,
    when
  );

  // Compare-and-swap against the tip we read: a concurrent upload fails loudly
  // rather than silently discarding someone's version.
  await updateRef(repoDir, MAIN_REF, commit, parent);

  return {
    commit,
    canonical,
    metadata: JSON.parse(canonical.songJson) as SongMetadata,
    originalPath
  };
}

function assertIdentical(a: CanonicalSong, b: CanonicalSong): void {
  const problems: string[] = [];
  if (a.songJson !== b.songJson) problems.push('song.json');
  if (a.structure.join('\n') !== b.structure.join('\n')) problems.push(STRUCTURE_PATH);
  if (a.tracks.length !== b.tracks.length) problems.push('track count');
  for (let i = 0; i < a.tracks.length; i++) {
    const first = a.tracks[i];
    const second = b.tracks[i];
    if (!first || !second) continue;
    if (first.path !== second.path || first.lines.join('\n') !== second.lines.join('\n')) {
      problems.push(first.path);
    }
  }
  if (problems.length > 0) {
    throw new UploadError(
      `Refusing to store this file: reading it twice produced different results (${problems.join(', ')}). This is a bug in GuitHub, not in your file.`
    );
  }
}

async function sha256(bytes: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

/** Writes blobs and the nested trees they live in, returning the root tree hash. */
async function buildTree(repoDir: string, files: ReadonlyMap<string, Buffer>): Promise<string> {
  const root: DirNode = { dirs: new Map(), blobs: new Map() };
  for (const [path, content] of files) {
    const segments = path.split('/');
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      let child = node.dirs.get(name);
      if (!child) {
        child = { dirs: new Map(), blobs: new Map() };
        node.dirs.set(name, child);
      }
      node = child;
    }
    node.blobs.set(segments[segments.length - 1]!, content);
  }
  return writeNode(repoDir, root);
}

interface DirNode {
  readonly dirs: Map<string, DirNode>;
  readonly blobs: Map<string, Buffer>;
}

async function writeNode(repoDir: string, node: DirNode): Promise<string> {
  const entries: TreeEntry[] = [];
  for (const [name, content] of node.blobs) {
    entries.push({ mode: '100644', type: 'blob', hash: await writeBlob(repoDir, content), name });
  }
  for (const [name, child] of node.dirs) {
    entries.push({ mode: '040000', type: 'tree', hash: await writeNode(repoDir, child), name });
  }
  return writeTree(repoDir, entries);
}

// ---------------------------------------------------------------------------
// Reading a stored version back
// ---------------------------------------------------------------------------

/**
 * Rebuilds the canonical form of a stored version from the committed text files.
 * Reading the text rather than re-parsing the binary is deliberate: the diff must
 * describe what history actually recorded, even if the canonicaliser has since changed.
 */
export async function readCanonicalAt(
  repoDir: string,
  commit: string
): Promise<CanonicalSong | null> {
  const songJson = await readTextAt(repoDir, commit, SONG_JSON);
  if (songJson === null) return null;
  const metadata = JSON.parse(songJson) as SongMetadata;
  const structureText = (await readTextAt(repoDir, commit, STRUCTURE_PATH)) ?? '';

  const tracks: CanonicalTrack[] = [];
  for (const track of metadata.tracks) {
    const content = await readTextAt(repoDir, commit, track.path);
    tracks.push({
      path: track.path,
      name: track.name,
      index: track.index,
      lines: content === null ? [] : parseTrackFile(content)
    });
  }

  return { songJson, structure: parseTrackFile(structureText), tracks };
}

export async function readProvenanceAt(
  repoDir: string,
  commit: string
): Promise<VersionProvenance | null> {
  const text = await readTextAt(repoDir, commit, VERSION_JSON);
  return text === null ? null : (JSON.parse(text) as VersionProvenance);
}

/** Returns the exact bytes that were uploaded for this version, and their filename. */
export async function readOriginalAt(
  repoDir: string,
  commit: string
): Promise<{ bytes: Buffer; filename: string } | null> {
  const provenance = await readProvenanceAt(repoDir, commit);
  const files = await listFilesAt(repoDir, commit);
  const originalPath = files.find(path => path.startsWith('original.'));
  if (!originalPath) return null;
  const bytes = await readFileAt(repoDir, commit, originalPath);
  if (!bytes) return null;
  return { bytes, filename: provenance?.originalFilename ?? originalPath };
}
