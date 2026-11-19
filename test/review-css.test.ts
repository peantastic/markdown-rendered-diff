import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../media/review.css', import.meta.url), 'utf8');
const buttonRule = css.slice(css.indexOf('button {'), css.indexOf('button {') + 400);
// the @media (prefers-reduced-motion) block, to assert the polish is opt-out there
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion'));

describe('review.css polish pass', () => {
  it('gives the base button a hover/press transition', () => {
    expect(buttonRule).toMatch(/transition:\s*background/);
  });

  it('nudges buttons on :active', () => {
    expect(css).toMatch(/button:active[^{}]*\{[^}]*transform:\s*translateY/);
  });

  it('animates the progress fill and seen-block fade', () => {
    expect(css).toMatch(/#cur \.prog i \{[^}]*transition:\s*width/);
    expect(css).toMatch(/section\.seg \{[^}]*transition:\s*opacity/);
  });

  it('softens the dialog shadow', () => {
    expect(css).toContain('box-shadow: 0 2px 8px rgba(0, 0, 0, .18)');
    expect(css).not.toContain('0 4px 16px rgba(0, 0, 0, .3)'); // old heavy shadow gone
  });

  it('disables every added transition and transform under reduce-motion', () => {
    expect(reduced).toMatch(/transition:\s*none\s*!important/);
    expect(reduced).toMatch(/transform:\s*none\s*!important/);
    for (const sel of ['button', '.gap', 'section.seg', '#cur .prog i']) {
      expect(reduced, sel).toContain(sel);
    }
  });

  it('keeps the palette on VS Code theme tokens (no new brand colours)', () => {
    // tokens still drive the chrome
    expect(css).toContain('var(--vscode-button-background)');
    expect(css).toContain('var(--vscode-button-secondaryBackground');
    // the polished button rule introduces no hard-coded hex colour
    expect(buttonRule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
