import { describe, expect, it } from 'vitest';
import { ariaPressed, changeLabelKey, progressAttrs } from '../webview/a11y';
import { WEBVIEW_STRINGS } from '../src/i18n/webviewStrings';

describe('ariaPressed', () => {
  it('maps a boolean to the aria-pressed string', () => {
    expect(ariaPressed(true)).toBe('true');
    expect(ariaPressed(false)).toBe('false');
  });
});

describe('changeLabelKey', () => {
  it('gives every change kind an accessible label that exists in the string table', () => {
    for (const kind of ['add', 'del', 'mod', 'move', 'moveSrc']) {
      const key = changeLabelKey[kind];
      expect(key, kind).toBeDefined();
      expect(WEBVIEW_STRINGS[key], key).toBeDefined();
    }
  });
  it('does not label unchanged blocks', () => {
    expect(changeLabelKey.eq).toBeUndefined();
  });
});

describe('progressAttrs', () => {
  it('exposes the seen/total counts as a progressbar', () => {
    const out = progressAttrs(3, 10, 'Seen 3/10 changes');
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuemin="0"');
    expect(out).toContain('aria-valuemax="10"');
    expect(out).toContain('aria-valuenow="3"');
    expect(out).toContain('aria-label="Seen 3/10 changes"');
  });
});
