import { describe, expect, it } from 'vitest';
import { buildExport } from '../src/panel/exportHtml';

describe('buildExport', () => {
  const out = buildExport({
    title: 'guide <v2>',
    bodyHtml: '<section class="seg k-add"><p>Added <ins>line</ins></p></section>',
    reviewCss: '.seg{color:red}',
    katexCss: '.katex{font-size:1em}',
  });

  it('produces a self-contained, script-free document', () => {
    expect(out.toLowerCase()).toContain('<!doctype html>');
    expect(out).not.toMatch(/<script/i); // no executable code in the export
  });

  it('embeds the rendered body and inlines both stylesheets', () => {
    expect(out).toContain('<ins>line</ins>');
    expect(out).toContain('.seg{color:red}');
    expect(out).toContain('.katex{font-size:1em}');
  });

  it('escapes the title', () => {
    expect(out).toContain('<title>guide &lt;v2&gt;</title>');
  });

  it('works without math (no katex css)', () => {
    const noMath = buildExport({ title: 't', bodyHtml: '<p>x</p>', reviewCss: 'body{}' });
    expect(noMath).toContain('<p>x</p>');
    expect(noMath).not.toMatch(/<script/i);
  });
});
