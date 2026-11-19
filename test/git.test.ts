import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultBranch } from '../src/git/git';
import { relInside } from '../src/baseline/baseline';

const repo = (branch: string) => {
  const d = mkdtempSync(join(tmpdir(), 'mrd-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', branch);
  writeFileSync(join(d, 'a.md'), '# a\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init');
  return d;
};

describe('git helpers', () => {
  it('detects main / master as default branch', async () => {
    expect(await defaultBranch(repo('main'))).toBe('main');
    expect(await defaultBranch(repo('master'))).toBe('master');
  });
  it('returns undefined when no usual branch exists', async () => {
    expect(await defaultBranch(repo('feature-x'))).toBeUndefined();
  });
});

describe('relInside', () => {
  it('returns a /-separated relative path inside the root', () => {
    expect(relInside('/r/repo', '/r/repo/docs/a.md')).toBe('docs/a.md');
    expect(relInside('/r/repo/', '/r/repo/a.md')).toBe('a.md');
  });
  it('rejects siblings with the same prefix', () => {
    expect(relInside('/r/repo', '/r/repo2/a.md')).toBeUndefined();
  });
});
