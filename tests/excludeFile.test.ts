import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readPatterns, readPatternEntries, appendPattern, removePattern } from '../src/excludeFile';

describe('excludeFile', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-exclude-explorer-file-'));
    filePath = path.join(tmpDir, 'exclude');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readPatterns', () => {
    it('returns an empty array when the file does not exist', () => {
      expect(readPatterns(filePath)).toEqual([]);
    });

    it('excludes blank lines and comments, and trims whitespace', () => {
      fs.writeFileSync(filePath, '# comment\n\n*.log\n  build/  \n');
      expect(readPatterns(filePath)).toEqual(['*.log', 'build/']);
    });
  });

  describe('readPatternEntries', () => {
    it('returns an empty array when the file does not exist', () => {
      expect(readPatternEntries(filePath)).toEqual([]);
    });

    it('pairs each pattern with its 1-based line number, skipping blanks and comments', () => {
      fs.writeFileSync(filePath, '# comment\n\n*.log\n  build/  \n');
      expect(readPatternEntries(filePath)).toEqual([
        { pattern: '*.log', line: 3 },
        { pattern: 'build/', line: 4 },
      ]);
    });
  });

  describe('appendPattern', () => {
    it('creates parent directories and the file if missing', () => {
      const nested = path.join(tmpDir, 'a', 'b', 'exclude');
      appendPattern(nested, '*.log');
      expect(readPatterns(nested)).toEqual(['*.log']);
    });

    it('does not duplicate an already-present pattern', () => {
      appendPattern(filePath, '*.log');
      appendPattern(filePath, '*.log');
      expect(readPatterns(filePath)).toEqual(['*.log']);
    });

    it('inserts a newline before appending when the file lacks a trailing one', () => {
      fs.writeFileSync(filePath, '*.log');
      appendPattern(filePath, 'build/');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('*.log\nbuild/\n');
    });

    it('ignores blank patterns', () => {
      appendPattern(filePath, '   ');
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('removePattern', () => {
    it('removes only the exactly matching line', () => {
      fs.writeFileSync(filePath, '*.log\nbuild/\ndist/\n');
      removePattern(filePath, 'build/');
      expect(readPatterns(filePath)).toEqual(['*.log', 'dist/']);
    });

    it('is a no-op when the file does not exist', () => {
      expect(() => removePattern(filePath, '*.log')).not.toThrow();
    });

    it('preserves CRLF line endings when rewriting the file', () => {
      fs.writeFileSync(filePath, '*.log\r\nbuild/\r\ndist/\r\n');
      removePattern(filePath, 'build/');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('*.log\r\ndist/\r\n');
    });
  });
});
