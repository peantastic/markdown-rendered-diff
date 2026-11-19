import { describe, expect, it } from 'vitest';
import { similarity, textOf, tokenizeHtml } from '../src/diff/tokenize';

describe('similarity (Dice on bigrams)', () => {
  it('is 1 for identical strings', () => {
    expect(similarity('hello', 'hello')).toBe(1);
  });
  it('is 0 for disjoint strings', () => {
    expect(similarity('abcd', 'wxyz')).toBe(0);
  });
  it('is 0 when either string has fewer than 2 characters', () => {
    expect(similarity('a', 'a')).toBe(1); // identical short-circuits to 1
    expect(similarity('a', 'ab')).toBe(0);
    expect(similarity('', 'ab')).toBe(0);
  });
  it('is between 0 and 1 for partial overlap and symmetric', () => {
    const a = similarity('night', 'nacht');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(similarity('night', 'nacht')).toBeCloseTo(similarity('nacht', 'night'));
  });
});

describe('tokenizeHtml', () => {
  it('keeps tags and entities as single tokens', () => {
    const toks = tokenizeHtml('a <b>x</b> &amp; y');
    expect(toks).toContain('<b>');
    expect(toks).toContain('</b>');
    expect(toks).toContain('&amp;');
  });
  it('segments CJK text into multiple word tokens', () => {
    const toks = tokenizeHtml('日本語です');
    expect(toks.length).toBeGreaterThan(1); // not lumped into one token
    expect(toks.join('')).toBe('日本語です'); // lossless
  });
  it('is lossless for mixed content', () => {
    const html = 'The <em>quick</em> fox';
    expect(tokenizeHtml(html).join('')).toBe(html);
  });
});

describe('textOf', () => {
  it('strips tags and decodes entities', () => {
    expect(textOf('<p>hello <b>world</b></p>')).toBe('hello world');
    expect(textOf('a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;')).toBe('a <b> & "c" \'d\'');
  });
  it('trims surrounding whitespace', () => {
    expect(textOf('  <span> x </span>  ')).toBe('x');
  });
});
