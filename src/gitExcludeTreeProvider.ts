import * as vscode from 'vscode';
import * as path from 'node:path';
import { readPatternEntries } from './excludeFile';

export interface RepoInfo {
  repoRoot: string;
  excludeFilePath: string;
  gitignoreFilePath: string;
  label: string;
}

export type GitExcludeNode =
  | { kind: 'localGroup'; excludeFilePath: string; label: string }
  | { kind: 'gitignoreGroup'; excludeFilePath: string; label: string }
  | { kind: 'globalGroup'; excludeFilePath: string }
  | { kind: 'pattern'; excludeFilePath: string; pattern: string; line: number };

/** Builds a `vscode.open` command; when `line` is given, the target line is revealed and selected. */
function openFileCommand(filePath: string, line?: number): vscode.Command {
  const uri = vscode.Uri.file(filePath);
  if (line === undefined) {
    return { command: 'vscode.open', title: 'Open File', arguments: [uri] };
  }

  const position = new vscode.Position(line - 1, 0);
  const options: vscode.TextDocumentShowOptions = {
    selection: new vscode.Range(position, position),
  };
  return { command: 'vscode.open', title: 'Open File', arguments: [uri, options] };
}

export class GitExcludeTreeProvider implements vscode.TreeDataProvider<GitExcludeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    void | GitExcludeNode | GitExcludeNode[]
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private alphabetical = false;

  constructor(
    private readonly getRepos: () => RepoInfo[],
    private readonly getGlobalExcludeFile: () => string | undefined
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Switches pattern ordering between file-definition order (default) and alphabetical. */
  setAlphabeticalSort(enabled: boolean): void {
    this.alphabetical = enabled;
    this.refresh();
  }

  getTreeItem(element: GitExcludeNode): vscode.TreeItem {
    if (element.kind === 'localGroup') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'gitExclude.localGroup';
      item.iconPath = new vscode.ThemeIcon('repo');
      item.tooltip = element.excludeFilePath;
      item.command = openFileCommand(element.excludeFilePath);
      return item;
    }

    if (element.kind === 'gitignoreGroup') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'gitExclude.gitignoreGroup';
      item.iconPath = new vscode.ThemeIcon('file');
      item.tooltip = element.excludeFilePath;
      item.command = openFileCommand(element.excludeFilePath);
      return item;
    }

    if (element.kind === 'globalGroup') {
      const item = new vscode.TreeItem('Global', vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'gitExclude.globalGroup';
      item.iconPath = new vscode.ThemeIcon('globe');
      item.tooltip = element.excludeFilePath;
      item.command = openFileCommand(element.excludeFilePath);
      return item;
    }

    const item = new vscode.TreeItem(element.pattern, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'gitExclude.pattern';
    item.iconPath = new vscode.ThemeIcon('circle-slash');
    item.tooltip = `${element.excludeFilePath}:${element.line}`;
    item.command = openFileCommand(element.excludeFilePath, element.line);
    return item;
  }

  getChildren(element?: GitExcludeNode): GitExcludeNode[] {
    if (!element) {
      const repoGroups: GitExcludeNode[] = this.getRepos().flatMap((repo) => [
        {
          kind: 'localGroup',
          excludeFilePath: repo.excludeFilePath,
          label: repo.label,
        },
        {
          kind: 'gitignoreGroup',
          excludeFilePath: repo.gitignoreFilePath,
          label: `.gitignore (${path.basename(repo.repoRoot)})`,
        },
      ]);

      const globalExcludeFile = this.getGlobalExcludeFile();
      const globalGroup: GitExcludeNode[] = globalExcludeFile
        ? [{ kind: 'globalGroup', excludeFilePath: globalExcludeFile }]
        : [];

      return [...repoGroups, ...globalGroup];
    }

    if (element.kind === 'pattern') {
      return [];
    }

    const entries = readPatternEntries(element.excludeFilePath);
    // Plain code-point ordering (not localeCompare) keeps sorting deterministic across
    // environments/locales — patterns are glob-like tokens (`*.log`, `.env`), not prose.
    const ordered = this.alphabetical
      ? [...entries].sort((a, b) => (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0))
      : entries;

    return ordered.map(({ pattern, line }) => ({
      kind: 'pattern',
      excludeFilePath: element.excludeFilePath,
      pattern,
      line,
    }));
  }
}
