// @vitest-environment jsdom
// Drives the real webview script (webview/main.ts) in a jsdom DOM to verify the
// focus trap and the ARIA attributes applied at render time.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pageBody } from '../src/panel/pageHtml';
import { WEBVIEW_STRINGS, WebviewStrings } from '../src/i18n/webviewStrings';

const $ = (id: string) => document.getElementById(id)!;
const helpBox = () => $('help').querySelector<HTMLElement>('.help-box')!;
const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

// a fresh render payload each time so tests don't share mutable prefs/segments
const sendRender = () =>
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'render', resetScroll: true,
      data: {
        key: '/repo|a.md', title: 'a.md', sub: 'HEAD', where: 'docs', working: true,
        stats: { add: 1, del: 0, mod: 0, move: 0 },
        segments: [{ id: 'seg1', kind: 'add', blockType: 'paragraph', unified: '<p>Added</p>', old: '', new: '<p>Added</p>' }],
        seen: [], pos: '1/1', hasPrev: false, hasNext: false,
        prefs: { mode: 'unified', collapse: true },
      },
    },
  }));

const openHelp = () => { const b = $('helpBtn') as HTMLButtonElement; b.focus(); if ($('help').hidden) b.click(); };
const closeHelp = () => { if (!$('help').hidden) ($('helpBtn') as HTMLButtonElement).click(); };

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage() {}, getState() { return undefined; }, setState() {} });
  (globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = pageBody(WEBVIEW_STRINGS as WebviewStrings);
  await import('../webview/main');
});

afterEach(() => closeHelp());

describe('shortcut dialog focus trap', () => {
  it('moves focus into the dialog and flags it expanded on open', () => {
    const btn = $('helpBtn');
    openHelp();
    expect($('help').hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(helpBox());
  });

  it('keeps Tab / Shift+Tab focus inside the dialog', () => {
    openHelp();
    for (const shift of [false, true]) {
      const ev = keydown('Tab', { shiftKey: shift });
      $('help').dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect($('help').contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape and returns focus to the opener', () => {
    const btn = $('helpBtn');
    openHelp();
    $('help').dispatchEvent(keydown('Escape'));
    expect($('help').hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });
});

describe('ARIA applied at render time', () => {
  it('reflects the view mode on the toggle buttons', () => {
    sendRender();
    expect($('mUnified').getAttribute('aria-pressed')).toBe('true');
    expect($('mSplit').getAttribute('aria-pressed')).toBe('false');
    document.dispatchEvent(keydown('s')); // toggle unified <-> split
    expect($('mUnified').getAttribute('aria-pressed')).toBe('false');
    expect($('mSplit').getAttribute('aria-pressed')).toBe('true');
  });

  it('labels each change block and renders a progressbar', () => {
    sendRender();
    const sec = $('content').querySelector('section.k-add')!;
    expect(sec.getAttribute('tabindex')).toBe('-1');
    expect(sec.getAttribute('role')).toBe('group');
    expect(sec.getAttribute('aria-label')).toBeTruthy();
    expect($('cur').querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('sets aria-current and moves focus when navigating changes', () => {
    sendRender();
    document.dispatchEvent(keydown('n'));
    const sec = $('content').querySelector('section.k-add')!;
    expect(sec.getAttribute('aria-current')).toBe('true');
    expect($('content').contains(document.activeElement)).toBe(true);
  });
});
