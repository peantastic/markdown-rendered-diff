import { beforeEach, describe, expect, it } from 'vitest';
import { ReviewState } from '../src/state/reviewState';
import { hash } from '../src/baseline/baseline';

// Minimal in-memory vscode.Memento
function memento() {
  const m = new Map<string, unknown>();
  return {
    get: (k: string, def?: unknown) => (m.has(k) ? m.get(k) : def),
    update: (k: string, v: unknown) => { if (v === undefined) m.delete(k); else m.set(k, v); return Promise.resolve(); },
    keys: () => [...m.keys()],
  } as any;
}

const ROOT = '/r/repo', REL = 'docs/a.md';

describe('ReviewState', () => {
  let ws: any, global: any, s: ReviewState;
  beforeEach(() => { ws = memento(); global = memento(); s = new ReviewState(ws, global); });

  describe('viewed is tied to content', () => {
    it('stays viewed only while content is unchanged', () => {
      expect(s.isViewed(ROOT, REL, 'v1')).toBe(false);
      s.setViewed(ROOT, REL, 'v1', true);
      expect(s.isViewed(ROOT, REL, 'v1')).toBe(true);
      expect(s.isViewed(ROOT, REL, 'v2')).toBe(false); // edited since
    });
    it('can be cleared', () => {
      s.setViewed(ROOT, REL, 'v1', true);
      s.setViewed(ROOT, REL, 'v1', false);
      expect(s.isViewed(ROOT, REL, 'v1')).toBe(false);
    });
  });

  describe('setSeen', () => {
    it('ignores ids that do not match the id pattern', () => {
      s.setSeen(ROOT, REL, 'not an id!', true);
      s.setSeen(ROOT, REL, 'a'.repeat(41), true);
      s.setSeen(ROOT, REL, 123 as any, true);
      expect(s.seen(ROOT, REL)).toEqual([]);
    });
    it('adds and removes valid ids', () => {
      s.setSeen(ROOT, REL, 'abc123', true);
      s.setSeen(ROOT, REL, 'def-456', true);
      expect(new Set(s.seen(ROOT, REL))).toEqual(new Set(['abc123', 'def-456']));
      s.setSeen(ROOT, REL, 'abc123', false);
      expect(s.seen(ROOT, REL)).toEqual(['def-456']);
    });
    it('caps at 2000 ids, keeping the most recent', () => {
      for (let i = 0; i < 2100; i++) s.setSeen(ROOT, REL, 'id' + i, true);
      const seen = s.seen(ROOT, REL);
      expect(seen.length).toBe(2000);
      expect(seen).toContain('id2099');
      expect(seen).not.toContain('id0');
    });
  });

  describe('prefs', () => {
    it('defaults to unified / collapse on', () => {
      expect(s.prefs()).toEqual({ mode: 'unified', collapse: true });
    });
    it('keeps only known keys with valid values', () => {
      s.setPrefs({ mode: 'split', collapse: false, junk: 1 } as any);
      expect(s.prefs()).toEqual({ mode: 'split', collapse: false });
      s.setPrefs({ mode: 'nonsense', collapse: 'nope' } as any); // ignored
      expect(s.prefs()).toEqual({ mode: 'split', collapse: false });
    });
  });

  describe('baseline', () => {
    const def = { kind: 'head' as const };
    it('falls back to the default for invalid stored data', () => {
      void ws.update('baseline', { kind: 'bogus' });
      expect(s.baseline(def)).toEqual(def);
    });
    it('returns stored baseline when valid', () => {
      s.setBaseline({ kind: 'rev', rev: 'main' });
      expect(s.baseline(def)).toEqual({ kind: 'rev', rev: 'main' });
    });
  });
});

// sanity: hash used by viewed keys is stable
describe('content hashing for viewed state', () => {
  it('matches the shared hash()', () => {
    const ws = memento(), s = new ReviewState(ws, memento());
    s.setViewed(ROOT, REL, 'content', true);
    expect(ws.get('viewed:' + ROOT + '|' + REL)).toBe(hash('content'));
  });
});
