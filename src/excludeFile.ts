import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PatternEntry {
  pattern: string;
  /** 1-based line number of `pattern` within the file. */
  line: number;
}

/** Reads non-empty, non-comment pattern lines from a gitignore-style file, with their line numbers. */
export function readPatternEntries(filePath: string): PatternEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const entries: PatternEntry[] = [];

  content.split(/\r?\n/).forEach((rawLine, index) => {
    const pattern = rawLine.trim();
    if (pattern.length > 0 && !pattern.startsWith('#')) {
      entries.push({ pattern, line: index + 1 });
    }
  });

  return entries;
}

/** Reads non-empty, non-comment pattern lines from a gitignore-style file. */
export function readPatterns(filePath: string): string[] {
  return readPatternEntries(filePath).map((entry) => entry.pattern);
}

/** Appends `pattern` to `filePath`, creating parent directories as needed. No-op if already present. */
export function appendPattern(filePath: string, pattern: string): void {
  const trimmed = pattern.trim();
  if (!trimmed || readPatterns(filePath).includes(trimmed)) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(filePath, `${existing}${separator}${trimmed}\n`, 'utf8');
}

/** Removes the line exactly matching `pattern` (after trim) from `filePath`. No-op if the file doesn't exist. */
export function removePattern(filePath: string, pattern: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const trimmed = pattern.trim();
  const content = fs.readFileSync(filePath, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const filtered = content.split(/\r?\n/).filter((line) => line.trim() !== trimmed);
  fs.writeFileSync(filePath, filtered.join(eol), 'utf8');
}
