import { describe, expect, it } from 'vitest';
import { CACHE_MAX, cachedDiff } from '../src/panel/diffPanel';

// vitest isolates modules per test file, so the module-level cache starts empty here.
const d = (n: number) => cachedDiff(`# old ${n}\n`, `# new ${n}\n`);

describe('cachedDiff', () => {
  it('returns the same result object for identical input (cache hit)', () => {
    const r = cachedDiff('# A\n', '# B\n');
    expect(cachedDiff('# A\n', '# B\n')).toBe(r);
  });

  it('keys on the html flag', () => {
    const withHtml = cachedDiff('# C\n', '# D\n', true);
    expect(cachedDiff('# C\n', '# D\n', false)).not.toBe(withHtml);
    expect(cachedDiff('# C\n', '# D\n', true)).toBe(withHtml);
  });

  it('evicts the least-recently-used entry when full', () => {
    const cold = d(1000); // inserted first, never touched again
    for (let i = 0; i < CACHE_MAX; i++) d(i); // overflow with distinct entries
    // `cold` is the oldest and was never re-used -> evicted -> recomputed (new object)
    expect(d(1000)).not.toBe(cold);
  });

  it('keeps a frequently-used entry alive (move-to-end on hit)', () => {
    const hot = d(2000);
    for (let i = 0; i < CACHE_MAX + 50; i++) {
      d(3000 + i); // push many distinct entries
      d(2000); // touch `hot` so it stays most-recently-used
    }
    // without move-to-end `hot` would have been evicted long ago
    expect(d(2000)).toBe(hot);
  });
});
