import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

export type ExecFileFn = (
  file: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

export interface RepoLocation {
  /** The working directory root, where `.gitignore` lives and relative patterns are computed from. */
  worktreeRoot: string;
  /** The shared git directory where `info/exclude` lives — the same across every worktree of a repo. */
  gitCommonDir: string;
}

/**
 * Resolves the common git directory referenced by a worktree/submodule `.git` file
 * (a single line like `gitdir: <path>`). Worktree gitdirs contain a `commondir` file
 * pointing back to the repository's shared `.git` directory, which is where `info/exclude`
 * actually lives; when there's no `commondir` (e.g. a submodule), the referenced gitdir
 * itself is used. Returns undefined if the file doesn't match the expected format.
 */
function resolveGitFileCommonDir(dotGitFilePath: string): string | undefined {
  const content = fs.readFileSync(dotGitFilePath, 'utf8').trim();
  const match = content.match(/^gitdir:\s*(.+)$/);
  if (!match) {
    return undefined;
  }

  const referencedGitDir = path.resolve(path.dirname(dotGitFilePath), match[1].trim());
  const commonDirFile = path.join(referencedGitDir, 'commondir');
  if (!fs.existsSync(commonDirFile)) {
    return referencedGitDir;
  }

  const commonDirContent = fs.readFileSync(commonDirFile, 'utf8').trim();
  return path.resolve(referencedGitDir, commonDirContent);
}

/**
 * Walks up from `startDir` looking for a `.git` entry. Supports standard repositories
 * (`.git` as a directory) as well as worktrees and submodules (`.git` as a file pointing
 * elsewhere), resolving to the correct shared git common directory in both cases.
 */
export function findRepoRoot(startDir: string): RepoLocation | undefined {
  let dir = path.resolve(startDir);

  while (true) {
    const gitPath = path.join(dir, '.git');
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        return { worktreeRoot: dir, gitCommonDir: gitPath };
      }
      /* v8 ignore else -- @preserve: `.git` is always either a directory or a file in practice */
      if (stat.isFile()) {
        const gitCommonDir = resolveGitFileCommonDir(gitPath);
        if (gitCommonDir) {
          return { worktreeRoot: dir, gitCommonDir };
        }
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Resolves the path to the user's global gitignore file, mirroring Git's own
 * resolution order: the configured `core.excludesFile` (tilde-expanded via
 * `--path`), falling back to Git's built-in default of
 * `$XDG_CONFIG_HOME/git/ignore` (or `~/.config/git/ignore`) when unset.
 */
export async function resolveGlobalExcludesFile(
  execFile: ExecFileFn = execFileAsync
): Promise<string> {
  try {
    const { stdout } = await execFile('git', [
      'config',
      '--global',
      '--path',
      '--get',
      'core.excludesFile',
    ]);
    const value = stdout.trim();
    if (value) {
      return value;
    }
  } catch {
    // core.excludesFile is unset (or git is unavailable) — fall through to Git's default.
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfigHome, 'git', 'ignore');
}
