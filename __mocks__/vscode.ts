import { vi } from 'vitest';

class EventEmitter<T> {
  private readonly listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: vi.fn() };
  };

  fire(data?: T): void {
    this.listeners.forEach((listener) => listener(data as T));
  }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

class TreeItem {
  label: string;
  collapsibleState?: number;
  contextValue?: string;
  iconPath?: unknown;
  tooltip?: string;
  command?: unknown;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
}

class Position {
  line: number;
  character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  start: Position;
  end: Position;
  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

const Uri = {
  file: (fsPath: string) => ({ fsPath, scheme: 'file', toString: () => fsPath }),
};

function createFileSystemWatcherMock() {
  return {
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}

const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
};

const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
};

const workspace = {
  workspaceFolders: undefined as
    Array<{ uri: { fsPath: string }; name: string; index: number }> | undefined,
  createFileSystemWatcher: vi.fn(() => createFileSystemWatcherMock()),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
};

export {
  commands,
  window,
  workspace,
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  Position,
  Range,
  Uri,
};
