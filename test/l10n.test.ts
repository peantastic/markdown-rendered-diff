import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain ESM script without types
import { collect } from '../scripts/l10n-extract.mjs';

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(',');
const LANGS = ['vi', 'ja', 'zh-cn'];

describe('l10n bundles', () => {
  const keys: string[] = collect();
  it('English bundle is up to date with the source', () => {
    expect(Object.keys(json('l10n/bundle.l10n.json')).sort()).toEqual(keys);
  });
  for (const lang of LANGS) {
    it(`${lang}: every string translated with the same placeholders`, () => {
      const b = json(`l10n/bundle.l10n.${lang}.json`);
      expect(Object.keys(b).sort()).toEqual(keys);
      for (const k of keys) expect(placeholders(b[k]), k).toBe(placeholders(k));
    });
    it(`${lang}: manifest strings complete`, () => {
      expect(Object.keys(json(`package.nls.${lang}.json`)).sort()).toEqual(Object.keys(json('package.nls.json')).sort());
    });
  }
  it('every %key% in package.json exists in package.nls.json', () => {
    const nls = json('package.nls.json');
    const used = [...readFileSync('package.json', 'utf8').matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]);
    for (const k of used) expect(nls[k], k).toBeDefined();
  });
});
