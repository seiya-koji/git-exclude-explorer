import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findRepoRoot, resolveGlobalExcludesFile } from '../src/repoDiscovery';

describe('findRepoRoot', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-exclude-explorer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds the repo root by walking up from a nested directory', () => {
    const repoRoot = path.join(tmpRoot, 'repo');
    const nested = path.join(repoRoot, 'src', 'nested');
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });

    expect(findRepoRoot(nested)).toEqual({
      worktreeRoot: repoRoot,
      gitCommonDir: path.join(repoRoot, '.git'),
    });
  });

  it('returns the same directory when it directly contains .git', () => {
    const repoRoot = path.join(tmpRoot, 'repo2');
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });

    expect(findRepoRoot(repoRoot)).toEqual({
      worktreeRoot: repoRoot,
      gitCommonDir: path.join(repoRoot, '.git'),
    });
  });

  it('returns undefined when no .git entry exists up the tree', () => {
    const lonely = path.join(tmpRoot, 'no-repo');
    fs.mkdirSync(lonely, { recursive: true });

    expect(findRepoRoot(lonely)).toBeUndefined();
  });

  it('resolves a worktree .git file to the shared common git directory', () => {
    const mainGitDir = path.join(tmpRoot, 'main-repo', '.git');
    const worktreeGitDir = path.join(mainGitDir, 'worktrees', 'feature-x');
    const worktreeRoot = path.join(tmpRoot, 'feature-x-worktree');

    fs.mkdirSync(worktreeGitDir, { recursive: true });
    fs.writeFileSync(path.join(worktreeGitDir, 'commondir'), '../..\n');
    fs.mkdirSync(worktreeRoot, { recursive: true });
    fs.writeFileSync(path.join(worktreeRoot, '.git'), `gitdir: ${worktreeGitDir}\n`);

    expect(findRepoRoot(worktreeRoot)).toEqual({ worktreeRoot, gitCommonDir: mainGitDir });
  });

  it('falls back to the referenced gitdir itself when there is no commondir file (e.g. submodules)', () => {
    const submoduleGitDir = path.join(tmpRoot, 'parent-repo', '.git', 'modules', 'sub');
    const submoduleRoot = path.join(tmpRoot, 'parent-repo', 'sub');

    fs.mkdirSync(submoduleGitDir, { recursive: true });
    fs.mkdirSync(submoduleRoot, { recursive: true });
    fs.writeFileSync(path.join(submoduleRoot, '.git'), `gitdir: ${submoduleGitDir}\n`);

    expect(findRepoRoot(submoduleRoot)).toEqual({
      worktreeRoot: submoduleRoot,
      gitCommonDir: submoduleGitDir,
    });
  });

  it('returns undefined for a malformed .git file', () => {
    const dir = path.join(tmpRoot, 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.git'), 'not a valid gitdir line\n');

    expect(findRepoRoot(dir)).toBeUndefined();
  });
});

describe('resolveGlobalExcludesFile', () => {
  it('returns the git-configured path when core.excludesFile is set', async () => {
    const execFile = vi
      .fn()
      .mockResolvedValue({ stdout: '/home/user/.gitignore_global\n', stderr: '' });

    const result = await resolveGlobalExcludesFile(execFile);

    expect(result).toBe('/home/user/.gitignore_global');
    expect(execFile).toHaveBeenCalledWith('git', [
      'config',
      '--global',
      '--path',
      '--get',
      'core.excludesFile',
    ]);
  });

  it('falls back to the XDG default when core.excludesFile resolves to an empty value', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '\n', stderr: '' });
    const originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/home/user/.config';

    try {
      const result = await resolveGlobalExcludesFile(execFile);
      expect(result).toBe(path.join('/home/user/.config', 'git', 'ignore'));
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg;
      }
    }
  });

  it('falls back to the XDG default when core.excludesFile is unset', async () => {
    const execFile = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('exit status 1'), { code: 1 }));
    const originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/home/user/.config';

    try {
      const result = await resolveGlobalExcludesFile(execFile);
      expect(result).toBe(path.join('/home/user/.config', 'git', 'ignore'));
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg;
      }
    }
  });

  it('falls back to ~/.config/git/ignore when XDG_CONFIG_HOME is also unset', async () => {
    const execFile = vi.fn().mockRejectedValue(new Error('git not found'));
    const originalXdg = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;

    try {
      const result = await resolveGlobalExcludesFile(execFile);
      expect(result).toBe(path.join(os.homedir(), '.config', 'git', 'ignore'));
    } finally {
      if (originalXdg !== undefined) {
        process.env.XDG_CONFIG_HOME = originalXdg;
      }
    }
  });
});
