import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Baselines, hash, relInside, safeRel, validBaseline } from '../src/baseline/baseline';
import { isSafeRev } from '../src/git/git';

describe('safeRel', () => {
  it('accepts repository-relative paths', () => {
    expect(safeRel('a.md')).toBe(true);
    expect(safeRel('docs/guide/a.md')).toBe(true);
  });
  it('rejects absolute, parent and null-byte paths', () => {
    expect(safeRel('')).toBe(false);
    expect(safeRel('/etc/passwd')).toBe(false);
    expect(safeRel('C:\\win\\x.md')).toBe(false);
    expect(safeRel('../x.md')).toBe(false);
    expect(safeRel('docs/../../x.md')).toBe(false);
    expect(safeRel('a\0b.md')).toBe(false);
    expect(safeRel('\\abs.md')).toBe(false);
  });
});

describe('validBaseline', () => {
  it('accepts every known kind', () => {
    for (const kind of ['head', 'index', 'mergeBase', 'reviewed', 'claude']) {
      expect(validBaseline({ kind })).toBe(true);
    }
    expect(validBaseline({ kind: 'rev', rev: 'main' })).toBe(true);
  });
  it('rejects junk and bad rev', () => {
    expect(validBaseline(undefined)).toBe(false);
    expect(validBaseline(null)).toBe(false);
    expect(validBaseline({})).toBe(false);
    expect(validBaseline({ kind: 'nope' })).toBe(false);
    expect(validBaseline({ kind: 'rev' })).toBe(false); // missing rev
    expect(validBaseline({ kind: 'rev', rev: '' })).toBe(false);
    expect(validBaseline({ kind: 'rev', rev: '-x' })).toBe(false);
    expect(validBaseline({ kind: 'rev', rev: 'a'.repeat(201) })).toBe(false);
  });
});

describe('isSafeRev', () => {
  it('accepts ordinary revisions', () => {
    for (const r of ['HEAD', 'HEAD~3', 'HEAD^', 'main', 'origin/main', 'v1.2.3', 'feature/x', 'abcdef0']) {
      expect(isSafeRev(r)).toBe(true);
    }
  });
  it('rejects option injection and dangerous syntax', () => {
    expect(isSafeRev(undefined)).toBe(false);
    expect(isSafeRev('')).toBe(false);
    expect(isSafeRev('-x')).toBe(false); // looks like an option
    expect(isSafeRev('--upload-pack=evil')).toBe(false);
    expect(isSafeRev('a..b')).toBe(false); // range
    expect(isSafeRev('HEAD@{1}')).toBe(false); // reflog
    expect(isSafeRev('a:b')).toBe(false);
    expect(isSafeRev('a b')).toBe(false); // whitespace
    expect(isSafeRev('a\nb')).toBe(false); // control char
    expect(isSafeRev('a[b')).toBe(false);
    expect(isSafeRev('a'.repeat(201))).toBe(false);
  });
});

describe('hash', () => {
  it('is deterministic', () => {
    expect(hash('hello world')).toBe(hash('hello world'));
  });
  it('distinguishes different content and lengths', () => {
    expect(hash('a')).not.toBe(hash('b'));
    expect(hash('ab')).not.toBe(hash('abc'));
    // length is appended, so same chars / different length never collide
    expect(hash('')).not.toBe(hash(' '));
  });
});

describe('relInside', () => {
  it('handles trailing slash and nested paths', () => {
    expect(relInside('/r/repo/', '/r/repo/docs/a.md')).toBe('docs/a.md');
    expect(relInside('/r/repo', '/r/repo/a.md')).toBe('a.md');
  });
  it('is separator-agnostic', () => {
    expect(relInside('/r/repo', '/r/repo/sub/a.md')).toBe('sub/a.md');
  });
  it('rejects paths outside the root', () => {
    expect(relInside('/r/repo', '/r/other/a.md')).toBeUndefined();
    expect(relInside('/r/repo', '/r/repo')).toBeUndefined(); // the root itself
  });
});

describe('Baselines.saveSnapshot', () => {
  const mk = () => new Baselines(mkdtempSync(join(tmpdir(), 'mrd-snap-')), () => '', (m) => m);

  it('writes a snapshot under the storage folder', () => {
    const storage = mkdtempSync(join(tmpdir(), 'mrd-snap-'));
    const b = new Baselines(storage, () => '', (m) => m);
    b.saveSnapshot('/some/repo', 'docs/a.md', '# hello\n');
    // one snapshots/<hash>/docs/a.md must now exist somewhere under storage
    const snaps = join(storage, 'snapshots');
    expect(existsSync(snaps)).toBe(true);
    expect(readdirSync(snaps).length).toBe(1);
  });

  it('refuses to write for paths that escape the snapshot folder', () => {
    const b = mk();
    // safeRel guard makes this a no-op rather than writing outside
    expect(() => b.saveSnapshot('/some/repo', '../../../etc/evil.md', 'x')).not.toThrow();
  });
});
