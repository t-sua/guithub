import { spawn } from 'node:child_process';

/**
 * Thin wrapper over the git binary.
 *
 * Arguments are always passed as an array and never interpolated into a shell
 * string, so a song title or track name can never be read as a command. Paths that
 * could begin with `-` are separated from options with `--`.
 */

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface CommitIdentity {
  readonly name: string;
  readonly email: string;
}

interface RunOptions {
  readonly input?: Buffer | string;
  readonly env?: NodeJS.ProcessEnv;
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Never prompt for credentials, and ignore whatever git config happens to exist
    // on the host so that behaviour is identical on a laptop and on the server.
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    LC_ALL: 'C'
  };
}

/** Runs git and returns stdout as raw bytes. */
export function runGit(
  args: readonly string[],
  options: RunOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], {
      env: { ...baseEnv(), ...options.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(chunk as Buffer));
    child.stderr.on('data', chunk => stderr.push(chunk as Buffer));

    child.on('error', error => {
      reject(new GitError(`could not run git: ${error.message}`, args, ''));
    });

    child.on('close', code => {
      const errorText = Buffer.concat(stderr).toString('utf8');
      if (code === 0) resolve(Buffer.concat(stdout));
      else {
        reject(
          new GitError(
            `git ${args.join(' ')} exited with ${code}: ${errorText.trim()}`,
            args,
            errorText
          )
        );
      }
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export async function git(
  repoDir: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<Buffer> {
  return runGit(['--git-dir', repoDir, ...args], options);
}

export async function gitText(
  repoDir: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<string> {
  return (await git(repoDir, args, options)).toString('utf8');
}

export async function gitBuffer(repoDir: string, args: readonly string[]): Promise<Buffer> {
  return git(repoDir, args);
}

export async function initBareRepo(repoDir: string): Promise<void> {
  await runGit(['init', '--bare', '--initial-branch=main', repoDir]);
}

// ---------------------------------------------------------------------------
// Object plumbing
//
// Versions are written with plumbing rather than a working tree: hash-object,
// mktree and commit-tree. There is no checkout anywhere on the server, so two
// uploads can never collide over a shared working directory.
// ---------------------------------------------------------------------------

export interface TreeEntry {
  readonly mode: '100644' | '040000';
  readonly type: 'blob' | 'tree';
  readonly hash: string;
  readonly name: string;
}

export async function writeBlob(repoDir: string, content: Buffer): Promise<string> {
  const output = await gitText(repoDir, ['hash-object', '-w', '--stdin'], { input: content });
  return output.trim();
}

export async function writeTree(
  repoDir: string,
  entries: readonly TreeEntry[]
): Promise<string> {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const input = `${sorted.map(e => `${e.mode} ${e.type} ${e.hash}\t${e.name}`).join('\n')}\n`;
  const output = await gitText(repoDir, ['mktree'], { input });
  return output.trim();
}

export async function commitTree(
  repoDir: string,
  treeHash: string,
  parents: readonly string[],
  message: string,
  author: CommitIdentity,
  when: Date
): Promise<string> {
  const args = ['commit-tree', treeHash];
  for (const parent of parents) args.push('-p', parent);
  const timestamp = `${Math.floor(when.getTime() / 1000)} +0000`;
  const output = await gitText(repoDir, args, {
    input: message,
    env: {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_AUTHOR_DATE: timestamp,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_COMMITTER_DATE: timestamp
    }
  });
  return output.trim();
}

/**
 * Moves a ref, asserting what it pointed at beforehand. The compare-and-swap makes
 * concurrent uploads safe: if someone else committed since we read the tip, this
 * fails rather than silently discarding their version.
 */
export async function updateRef(
  repoDir: string,
  ref: string,
  newValue: string,
  oldValue: string | null
): Promise<void> {
  await gitText(repoDir, ['update-ref', ref, newValue, oldValue ?? '']);
}

export async function resolveRef(repoDir: string, ref: string): Promise<string | null> {
  try {
    return (await gitText(repoDir, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  } catch {
    return null;
  }
}
