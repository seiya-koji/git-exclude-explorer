import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitExcludeTreeProvider, GitExcludeNode } from '../src/gitExcludeTreeProvider';

function patternsOf(nodes: GitExcludeNode[]): string[] {
  return nodes.map((node) => (node as Extract<GitExcludeNode, { kind: 'pattern' }>).pattern);
}

describe('GitExcludeTreeProvider', () => {
  let tmpDir: string;
  let localExclude: string;
  let gitignore: string;
  let globalExclude: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-exclude-explorer-tree-'));
    localExclude = path.join(tmpDir, 'local-exclude');
    gitignore = path.join(tmpDir, 'gitignore');
    globalExclude = path.join(tmpDir, 'global-ignore');
    fs.writeFileSync(localExclude, '*.log\n');
    fs.writeFileSync(gitignore, 'node_modules/\n');
    fs.writeFileSync(globalExclude, '.DS_Store\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists a local group and a .gitignore group per repo, plus a global group at the root', () => {
    const provider = new GitExcludeTreeProvider(
      () => [
        {
          repoRoot: tmpDir,
          excludeFilePath: localExclude,
          gitignoreFilePath: gitignore,
          label: 'Local (repo)',
        },
      ],
      () => globalExclude
    );

    expect(provider.getChildren()).toEqual([
      { kind: 'localGroup', excludeFilePath: localExclude, label: 'Local (repo)' },
      {
        kind: 'gitignoreGroup',
        excludeFilePath: gitignore,
        label: `.gitignore (${path.basename(tmpDir)})`,
      },
      { kind: 'globalGroup', excludeFilePath: globalExclude },
    ]);
  });

  it('omits the global group when no global exclude file is resolved', () => {
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => undefined
    );
    expect(provider.getChildren()).toEqual([]);
  });

  it('returns pattern leaves for a group node', () => {
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => globalExclude
    );
    const [globalGroup] = provider.getChildren();

    expect(provider.getChildren(globalGroup)).toEqual([
      { kind: 'pattern', excludeFilePath: globalExclude, pattern: '.DS_Store', line: 1 },
    ]);
  });

  it('returns no children for a pattern leaf', () => {
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => undefined
    );
    expect(
      provider.getChildren({
        kind: 'pattern',
        excludeFilePath: globalExclude,
        pattern: '.DS_Store',
        line: 1,
      })
    ).toEqual([]);
  });

  it('builds tree items with the expected context values', () => {
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => undefined
    );

    const localItem = provider.getTreeItem({
      kind: 'localGroup',
      excludeFilePath: localExclude,
      label: 'Local (repo)',
    });
    const gitignoreItem = provider.getTreeItem({
      kind: 'gitignoreGroup',
      excludeFilePath: gitignore,
      label: '.gitignore (repo)',
    });
    const globalItem = provider.getTreeItem({
      kind: 'globalGroup',
      excludeFilePath: globalExclude,
    });
    const patternItem = provider.getTreeItem({
      kind: 'pattern',
      excludeFilePath: localExclude,
      pattern: '*.log',
      line: 1,
    });

    expect(localItem.contextValue).toBe('gitExclude.localGroup');
    expect(gitignoreItem.contextValue).toBe('gitExclude.gitignoreGroup');
    expect(globalItem.contextValue).toBe('gitExclude.globalGroup');
    expect(patternItem.contextValue).toBe('gitExclude.pattern');
  });

  it('makes group items open their underlying file when selected', () => {
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => undefined
    );

    const localItem = provider.getTreeItem({
      kind: 'localGroup',
      excludeFilePath: localExclude,
      label: 'Local (repo)',
    });
    const globalItem = provider.getTreeItem({
      kind: 'globalGroup',
      excludeFilePath: globalExclude,
    });

    expect(localItem.command).toEqual(
      expect.objectContaining({
        command: 'vscode.open',
        arguments: [expect.objectContaining({ fsPath: localExclude })],
      })
    );
    expect(globalItem.command).toEqual(
      expect.objectContaining({
        command: 'vscode.open',
        arguments: [expect.objectContaining({ fsPath: globalExclude })],
      })
    );
  });

  it('makes pattern leaves jump to their line when selected', () => {
    fs.writeFileSync(globalExclude, '# comment\n.DS_Store\nThumbs.db\n');
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => globalExclude
    );
    const [globalGroup] = provider.getChildren();
    const [, thumbsDb] = provider.getChildren(globalGroup);

    expect(thumbsDb).toEqual({
      kind: 'pattern',
      excludeFilePath: globalExclude,
      pattern: 'Thumbs.db',
      line: 3,
    });

    const item = provider.getTreeItem(thumbsDb);
    expect(item.command).toEqual(
      expect.objectContaining({
        command: 'vscode.open',
        arguments: [
          expect.objectContaining({ fsPath: globalExclude }),
          expect.objectContaining({
            selection: expect.objectContaining({
              start: expect.objectContaining({ line: 2, character: 0 }),
            }),
          }),
        ],
      })
    );
  });

  it('keeps definition (file) order by default', () => {
    fs.writeFileSync(globalExclude, 'Thumbs.db\n.DS_Store\n*.tmp\n');
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => globalExclude
    );
    const [globalGroup] = provider.getChildren();

    expect(patternsOf(provider.getChildren(globalGroup))).toEqual([
      'Thumbs.db',
      '.DS_Store',
      '*.tmp',
    ]);
  });

  it('sorts alphabetically once setAlphabeticalSort(true) is called, and fires a refresh', () => {
    fs.writeFileSync(globalExclude, 'Thumbs.db\n.DS_Store\n*.tmp\n');
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => globalExclude
    );
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    provider.setAlphabeticalSort(true);

    expect(listener).toHaveBeenCalled();
    const [globalGroup] = provider.getChildren();
    expect(patternsOf(provider.getChildren(globalGroup))).toEqual([
      '*.tmp',
      '.DS_Store',
      'Thumbs.db',
    ]);
  });

  it('keeps a stable order between duplicate patterns when sorting alphabetically', () => {
    // Already near-ascending order so the sort exercises "greater than" and "equal"
    // pattern comparisons, not just "less than".
    fs.writeFileSync(globalExclude, '*.tmp\n.DS_Store\n.DS_Store\nThumbs.db\n');
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => globalExclude
    );

    provider.setAlphabeticalSort(true);

    const [globalGroup] = provider.getChildren();
    expect(patternsOf(provider.getChildren(globalGroup))).toEqual([
      '*.tmp',
      '.DS_Store',
      '.DS_Store',
      'Thumbs.db',
    ]);
  });

  it('reverts to definition order when setAlphabeticalSort(false) is called', () => {
    fs.writeFileSync(globalExclude, 'Thumbs.db\n.DS_Store\n*.tmp\n');
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => globalExclude
    );

    provider.setAlphabeticalSort(true);
    provider.setAlphabeticalSort(false);

    const [globalGroup] = provider.getChildren();
    expect(patternsOf(provider.getChildren(globalGroup))).toEqual([
      'Thumbs.db',
      '.DS_Store',
      '*.tmp',
    ]);
  });

  it('fires onDidChangeTreeData when refresh is called', () => {
    const provider = new GitExcludeTreeProvider(
      () => [],
      () => undefined
    );
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    provider.refresh();

    expect(listener).toHaveBeenCalled();
  });
});
