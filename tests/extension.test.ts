import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from '../src/extension';
import * as repoDiscovery from '../src/repoDiscovery';
import * as excludeFile from '../src/excludeFile';

vi.mock('../src/repoDiscovery', () => ({
  findRepoRoot: vi.fn(),
  resolveGlobalExcludesFile: vi.fn(),
}));

vi.mock('../src/excludeFile', () => ({
  appendPattern: vi.fn(),
  removePattern: vi.fn(),
}));

function getCommandHandler(commandId: string) {
  const call = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
    ([id]) => id === commandId
  );
  if (!call) {
    throw new Error(`command not registered: ${commandId}`);
  }
  return call[1] as (...args: unknown[]) => unknown;
}

function getRegisteredProvider() {
  const call = (vscode.window.registerTreeDataProvider as ReturnType<typeof vi.fn>).mock.calls[0];
  return call[1] as import('../src/gitExcludeTreeProvider').GitExcludeTreeProvider;
}

function getWorkspaceFoldersChangeHandler() {
  const call = (vscode.workspace.onDidChangeWorkspaceFolders as ReturnType<typeof vi.fn>).mock
    .calls[0];
  return call[0] as () => void;
}

describe('activate', () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      subscriptions: { push: vi.fn() },
    } as unknown as vscode.ExtensionContext;

    vi.mocked(repoDiscovery.resolveGlobalExcludesFile).mockResolvedValue(
      '/home/user/.config/git/ignore'
    );
    Object.assign(vscode.workspace, { workspaceFolders: undefined });
  });

  it('registers the tree data provider for the gitExclude view', async () => {
    await activate(context);

    expect(vscode.window.registerTreeDataProvider).toHaveBeenCalledWith(
      'gitExclude.view',
      expect.anything()
    );
  });

  it('registers all four commands and wires up subscriptions', async () => {
    await activate(context);

    const registeredIds = (
      vscode.commands.registerCommand as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);

    expect(registeredIds).toEqual(
      expect.arrayContaining([
        'gitExclude.refresh',
        'gitExclude.addToLocalExclude',
        'gitExclude.addToGitignore',
        'gitExclude.addToGlobalIgnore',
        'gitExclude.removeEntry',
      ])
    );
    expect(context.subscriptions.push).toHaveBeenCalled();
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalled();
  });

  it('addToLocalExclude appends the repo-relative path and refreshes', async () => {
    vi.mocked(repoDiscovery.findRepoRoot).mockReturnValue({
      worktreeRoot: '/repo',
      gitCommonDir: '/repo/.git',
    });
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToLocalExclude');
    await handler(vscode.Uri.file('/repo/sub/file.log'));

    expect(excludeFile.appendPattern).toHaveBeenCalledWith(
      expect.stringContaining('exclude'),
      'sub/file.log'
    );
  });

  it('addToLocalExclude uses the worktree root for the relative path but the shared common dir for the exclude file', async () => {
    vi.mocked(repoDiscovery.findRepoRoot).mockReturnValue({
      worktreeRoot: '/worktrees/feature-x',
      gitCommonDir: '/main-repo/.git',
    });
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToLocalExclude');
    await handler(vscode.Uri.file('/worktrees/feature-x/sub/file.log'));

    expect(excludeFile.appendPattern).toHaveBeenCalledWith(
      expect.stringContaining('main-repo'),
      'sub/file.log'
    );
  });

  it('addToLocalExclude shows an error when the file is outside any repo', async () => {
    vi.mocked(repoDiscovery.findRepoRoot).mockReturnValue(undefined);
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToLocalExclude');
    await handler(vscode.Uri.file('/outside/file.log'));

    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(excludeFile.appendPattern).not.toHaveBeenCalled();
  });

  it('addToGitignore appends the repo-relative path to .gitignore and refreshes', async () => {
    vi.mocked(repoDiscovery.findRepoRoot).mockReturnValue({
      worktreeRoot: '/repo',
      gitCommonDir: '/repo/.git',
    });
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToGitignore');
    await handler(vscode.Uri.file('/repo/sub/file.log'));

    expect(excludeFile.appendPattern).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
      'sub/file.log'
    );
  });

  it('addToGitignore shows an error when the file is outside any repo', async () => {
    vi.mocked(repoDiscovery.findRepoRoot).mockReturnValue(undefined);
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToGitignore');
    await handler(vscode.Uri.file('/outside/file.log'));

    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(excludeFile.appendPattern).not.toHaveBeenCalled();
  });

  it('addToGlobalIgnore prompts for a pattern prefilled with the basename, then appends it', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('*.tmp');
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToGlobalIgnore');
    await handler(vscode.Uri.file('/repo/file.tmp'));

    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'file.tmp' })
    );
    expect(excludeFile.appendPattern).toHaveBeenCalledWith(
      '/home/user/.config/git/ignore',
      '*.tmp'
    );
  });

  it('addToGlobalIgnore does nothing when the input box is cancelled', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToGlobalIgnore');
    await handler(vscode.Uri.file('/repo/file.tmp'));

    expect(excludeFile.appendPattern).not.toHaveBeenCalled();
  });

  it('watches the .gitignore file alongside the local exclude and global files', async () => {
    vi.mocked(repoDiscovery.findRepoRoot).mockReturnValue({
      worktreeRoot: '/repo',
      gitCommonDir: '/repo/.git',
    });
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ uri: { fsPath: '/repo' }, name: 'repo', index: 0 }],
    });

    await activate(context);

    const watchedTargets = (
      vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);

    expect(watchedTargets).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exclude'),
        expect.stringContaining('.gitignore'),
        '/home/user/.config/git/ignore',
      ])
    );
  });

  it('removeEntry removes the pattern from its source file', async () => {
    await activate(context);

    const handler = getCommandHandler('gitExclude.removeEntry');
    handler({ kind: 'pattern', excludeFilePath: '/repo/.git/info/exclude', pattern: '*.log' });

    expect(excludeFile.removePattern).toHaveBeenCalledWith('/repo/.git/info/exclude', '*.log');
  });

  it('removeEntry does nothing when no node is given', async () => {
    await activate(context);

    const handler = getCommandHandler('gitExclude.removeEntry');
    handler(undefined);

    expect(excludeFile.removePattern).not.toHaveBeenCalled();
  });

  it('removeEntry does nothing for a non-pattern node', async () => {
    await activate(context);

    const handler = getCommandHandler('gitExclude.removeEntry');
    handler({ kind: 'localGroup', excludeFilePath: '/repo/.git/info/exclude', label: 'Local' });

    expect(excludeFile.removePattern).not.toHaveBeenCalled();
  });

  it('addToLocalExclude does nothing when no uri is given', async () => {
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToLocalExclude');
    await handler(undefined);

    expect(excludeFile.appendPattern).not.toHaveBeenCalled();
  });

  it('addToGitignore does nothing when no uri is given', async () => {
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToGitignore');
    await handler(undefined);

    expect(excludeFile.appendPattern).not.toHaveBeenCalled();
  });

  it('addToGlobalIgnore does nothing when no uri is given', async () => {
    await activate(context);

    const handler = getCommandHandler('gitExclude.addToGlobalIgnore');
    await handler(undefined);

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(excludeFile.appendPattern).not.toHaveBeenCalled();
  });

  it('sortAlphabetically switches the provider to alphabetical order and updates the context key', async () => {
    Object.assign(vscode.workspace, {
      workspaceFolders: undefined,
    });
    await activate(context);
    const provider = getRegisteredProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    const handler = getCommandHandler('gitExclude.sortAlphabetically');
    await handler();

    expect(listener).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'gitExclude.sortAlphabetically',
      true
    );
  });

  it('sortByDefinitionOrder switches the provider back to definition order and updates the context key', async () => {
    await activate(context);
    const provider = getRegisteredProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    const handler = getCommandHandler('gitExclude.sortByDefinitionOrder');
    await handler();

    expect(listener).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'gitExclude.sortAlphabetically',
      false
    );
  });

  it('rewires the file watchers when the workspace folders change', async () => {
    await activate(context);

    const callsBefore = (vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mock
      .calls.length;
    const handler = getWorkspaceFoldersChangeHandler();
    handler();

    const callsAfter = (vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it('gitExclude.refresh triggers a tree data refresh', async () => {
    await activate(context);
    const provider = getRegisteredProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    const handler = getCommandHandler('gitExclude.refresh');
    handler();

    expect(listener).toHaveBeenCalled();
  });

  it('refreshes the tree when a watched file changes, is created, or is deleted', async () => {
    await activate(context);
    const provider = getRegisteredProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    const [watcherResult] = (vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>)
      .mock.results;
    const watcher = watcherResult.value as {
      onDidChange: ReturnType<typeof vi.fn>;
      onDidCreate: ReturnType<typeof vi.fn>;
      onDidDelete: ReturnType<typeof vi.fn>;
    };

    watcher.onDidChange.mock.calls[0][0]();
    watcher.onDidCreate.mock.calls[0][0]();
    watcher.onDidDelete.mock.calls[0][0]();

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('skips workspace folders that are not inside a Git repository', async () => {
    vi.mocked(repoDiscovery.findRepoRoot).mockReturnValue(undefined);
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ uri: { fsPath: '/not-a-repo' }, name: 'not-a-repo', index: 0 }],
    });
    await activate(context);
    const provider = getRegisteredProvider();

    expect(provider.getChildren()).toEqual([
      { kind: 'globalGroup', excludeFilePath: '/home/user/.config/git/ignore' },
    ]);
  });

  it('resolves the global exclude file lazily via the getter passed to the provider', async () => {
    await activate(context);
    const provider = getRegisteredProvider();

    expect(provider.getChildren()).toEqual(
      expect.arrayContaining([
        { kind: 'globalGroup', excludeFilePath: '/home/user/.config/git/ignore' },
      ])
    );
  });

  it('disposes all active watchers when the extension is torn down', async () => {
    await activate(context);

    const createdWatchers = (
      vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>
    ).mock.results.map((result) => result.value as { dispose: ReturnType<typeof vi.fn> });
    const pushedSubscriptions = (context.subscriptions.push as ReturnType<typeof vi.fn>).mock
      .calls[0] as Array<{ dispose: () => void }>;
    const watcherDisposable = pushedSubscriptions[pushedSubscriptions.length - 1];

    watcherDisposable.dispose();

    createdWatchers.forEach((watcher) => expect(watcher.dispose).toHaveBeenCalled());
  });

  it('deactivate is a no-op that can be safely called', () => {
    expect(() => deactivate()).not.toThrow();
  });
});
