import * as vscode from 'vscode';
import * as path from 'node:path';
import { findRepoRoot, resolveGlobalExcludesFile } from './repoDiscovery';
import { appendPattern, removePattern } from './excludeFile';
import { GitExcludeTreeProvider, GitExcludeNode, RepoInfo } from './gitExcludeTreeProvider';

function localExcludeFilePath(gitCommonDir: string): string {
  return path.join(gitCommonDir, 'info', 'exclude');
}

function repoGitignoreFilePath(worktreeRoot: string): string {
  return path.join(worktreeRoot, '.gitignore');
}

function discoverRepos(): RepoInfo[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const seen = new Map<string, RepoInfo>();

  for (const folder of folders) {
    const location = findRepoRoot(folder.uri.fsPath);
    if (location && !seen.has(location.worktreeRoot)) {
      seen.set(location.worktreeRoot, {
        repoRoot: location.worktreeRoot,
        excludeFilePath: localExcludeFilePath(location.gitCommonDir),
        gitignoreFilePath: repoGitignoreFilePath(location.worktreeRoot),
        label: `Local (${path.basename(location.worktreeRoot)})`,
      });
    }
  }

  return [...seen.values()];
}

export async function activate(context: vscode.ExtensionContext) {
  const globalExcludeFile = await resolveGlobalExcludesFile();

  const provider = new GitExcludeTreeProvider(discoverRepos, () => globalExcludeFile);

  let watchers: vscode.Disposable[] = [];

  function rewireWatchers() {
    watchers.splice(0).forEach((watcher) => watcher.dispose());

    const targets = [
      ...discoverRepos().flatMap((repo) => [repo.excludeFilePath, repo.gitignoreFilePath]),
      globalExcludeFile,
    ];
    watchers = targets.map((target) => {
      const watcher = vscode.workspace.createFileSystemWatcher(target);
      watcher.onDidChange(() => provider.refresh());
      watcher.onDidCreate(() => provider.refresh());
      watcher.onDidDelete(() => provider.refresh());
      return watcher;
    });
  }

  rewireWatchers();
  await vscode.commands.executeCommand('setContext', 'gitExclude.sortAlphabetically', false);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('gitExclude.view', provider),
    vscode.commands.registerCommand('gitExclude.sortAlphabetically', async () => {
      provider.setAlphabeticalSort(true);
      await vscode.commands.executeCommand('setContext', 'gitExclude.sortAlphabetically', true);
    }),
    vscode.commands.registerCommand('gitExclude.sortByDefinitionOrder', async () => {
      provider.setAlphabeticalSort(false);
      await vscode.commands.executeCommand('setContext', 'gitExclude.sortAlphabetically', false);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rewireWatchers();
      provider.refresh();
    }),
    vscode.commands.registerCommand('gitExclude.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('gitExclude.addToLocalExclude', async (uri?: vscode.Uri) => {
      if (!uri) {
        return;
      }
      const location = findRepoRoot(uri.fsPath);
      if (!location) {
        vscode.window.showErrorMessage('Git Exclude: This file is outside any Git repository.');
        return;
      }
      const pattern = path.relative(location.worktreeRoot, uri.fsPath).split(path.sep).join('/');
      appendPattern(localExcludeFilePath(location.gitCommonDir), pattern);
      provider.refresh();
    }),
    vscode.commands.registerCommand('gitExclude.addToGitignore', async (uri?: vscode.Uri) => {
      if (!uri) {
        return;
      }
      const location = findRepoRoot(uri.fsPath);
      if (!location) {
        vscode.window.showErrorMessage('Git Exclude: This file is outside any Git repository.');
        return;
      }
      const pattern = path.relative(location.worktreeRoot, uri.fsPath).split(path.sep).join('/');
      appendPattern(repoGitignoreFilePath(location.worktreeRoot), pattern);
      provider.refresh();
    }),
    vscode.commands.registerCommand('gitExclude.addToGlobalIgnore', async (uri?: vscode.Uri) => {
      if (!uri) {
        return;
      }
      const pattern = await vscode.window.showInputBox({
        prompt: 'Pattern to add to the global gitignore',
        value: path.basename(uri.fsPath),
      });
      if (!pattern) {
        return;
      }
      appendPattern(globalExcludeFile, pattern);
      provider.refresh();
    }),
    vscode.commands.registerCommand('gitExclude.removeEntry', (node?: GitExcludeNode) => {
      if (!node || node.kind !== 'pattern') {
        return;
      }
      removePattern(node.excludeFilePath, node.pattern);
      provider.refresh();
    }),
    { dispose: () => watchers.splice(0).forEach((watcher) => watcher.dispose()) }
  );
}

export function deactivate() {}
