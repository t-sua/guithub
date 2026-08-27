import { gitBuffer, gitText, resolveRef } from './git.js';

export interface VersionSummary {
  readonly commit: string;
  readonly shortCommit: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly date: string;
  readonly message: string;
}

export interface BlameLine {
  /** Zero-based bar index. */
  readonly bar: number;
  readonly commit: string;
  readonly shortCommit: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly date: string;
  readonly summary: string;
  readonly content: string;
}

/** Unit separator: cannot appear in a commit message, so splitting is unambiguous. */
const SEP = '\u001f';
const LOG_FORMAT = ['%H', '%h', '%an', '%ae', '%aI', '%s'].join('%x1f');

/** Newest first. */
export async function listVersions(
  repoDir: string,
  ref = 'refs/heads/main',
  limit = 200
): Promise<VersionSummary[]> {
  const head = await resolveRef(repoDir, ref);
  if (!head) return [];
  const output = await gitText(repoDir, [
    'log',
    `--max-count=${limit}`,
    `--format=${LOG_FORMAT}`,
    ref
  ]);
  const versions: VersionSummary[] = [];
  for (const line of output.split('\n')) {
    if (line.length === 0) continue;
    const [commit, shortCommit, authorName, authorEmail, date, message] = line.split(SEP);
    if (!commit) continue;
    versions.push({
      commit,
      shortCommit: shortCommit ?? commit.slice(0, 8),
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      date: date ?? '',
      message: message ?? ''
    });
  }
  return versions;
}

export async function readFileAt(
  repoDir: string,
  commit: string,
  path: string
): Promise<Buffer | null> {
  try {
    return await gitBuffer(repoDir, ['cat-file', 'blob', `${commit}:${path}`]);
  } catch {
    return null;
  }
}

export async function readTextAt(
  repoDir: string,
  commit: string,
  path: string
): Promise<string | null> {
  const buffer = await readFileAt(repoDir, commit, path);
  return buffer === null ? null : buffer.toString('utf8');
}

export async function listFilesAt(repoDir: string, commit: string): Promise<string[]> {
  const output = await gitText(repoDir, ['ls-tree', '-r', '--name-only', commit]);
  return output.split('\n').filter(line => line.length > 0);
}

/**
 * Per-bar authorship for one track file.
 *
 * `-M` and `-C` make git follow bars that moved within the file or came from another
 * file in the same commit, so rearranging a song keeps the credit with whoever wrote
 * the part rather than reassigning it to whoever moved it.
 */
export async function blameTrack(
  repoDir: string,
  commit: string,
  path: string
): Promise<BlameLine[]> {
  const output = await gitText(repoDir, [
    'blame',
    '--line-porcelain',
    '-M',
    '-C',
    commit,
    '--',
    path
  ]);
  return parseBlamePorcelain(output);
}

interface CommitInfo {
  authorName: string;
  authorEmail: string;
  authorTime: number;
  summary: string;
}

export function parseBlamePorcelain(output: string): BlameLine[] {
  const commits = new Map<string, CommitInfo>();
  const lines: BlameLine[] = [];

  let current: string | null = null;
  let finalLine = 0;

  for (const raw of output.split('\n')) {
    if (raw.length === 0) continue;

    if (raw.startsWith('\t')) {
      if (current === null) continue;
      const info = commits.get(current);
      lines.push({
        bar: finalLine - 1,
        commit: current,
        shortCommit: current.slice(0, 8),
        authorName: info?.authorName ?? '',
        authorEmail: info?.authorEmail ?? '',
        date: info ? new Date(info.authorTime * 1000).toISOString() : '',
        summary: info?.summary ?? '',
        content: raw.slice(1)
      });
      current = null;
      continue;
    }

    const headerMatch = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(raw);
    if (headerMatch) {
      current = headerMatch[1]!;
      finalLine = Number(headerMatch[2]);
      if (!commits.has(current)) {
        commits.set(current, { authorName: '', authorEmail: '', authorTime: 0, summary: '' });
      }
      continue;
    }

    if (current === null) continue;
    const info = commits.get(current);
    if (!info) continue;
    const space = raw.indexOf(' ');
    const key = space < 0 ? raw : raw.slice(0, space);
    const value = space < 0 ? '' : raw.slice(space + 1);
    switch (key) {
      case 'author':
        info.authorName = value;
        break;
      case 'author-mail':
        info.authorEmail = value.replace(/^<|>$/g, '');
        break;
      case 'author-time':
        info.authorTime = Number(value);
        break;
      case 'summary':
        info.summary = value;
        break;
      default:
        break;
    }
  }

  return lines;
}
