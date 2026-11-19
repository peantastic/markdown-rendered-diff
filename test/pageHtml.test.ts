import { describe, expect, it } from 'vitest';
import { i18nScript, pageBody } from '../src/panel/pageHtml';
import { WEBVIEW_STRINGS, WebviewStrings } from '../src/i18n/webviewStrings';

describe('i18nScript', () => {
  it('escapes "<" so document content cannot close the script tag', () => {
    const out = i18nScript('en', { ...WEBVIEW_STRINGS, before: '</script><img src=x onerror=alert(1)>' } as WebviewStrings);
    // the only real </script> is the one closing tag this function emits
    expect(out.match(/<\/script>/g)!.length).toBe(1);
    expect(out).toContain('\\u003c'); // the payload's "<" was neutralised
    expect(out).not.toContain('<img'); // never a live tag
  });
});

describe('pageBody', () => {
  it('HTML-escapes translated strings', () => {
    const t = { ...WEBVIEW_STRINGS, viewUnified: '<b>"x"&y' } as WebviewStrings;
    const out = pageBody(t);
    expect(out).toContain('&lt;b&gt;&quot;x&quot;&amp;y');
    expect(out).not.toContain('<b>"x"&y');
  });

  describe('accessibility', () => {
    const out = pageBody(WEBVIEW_STRINGS as WebviewStrings);

    it('marks the toolbar and labels it', () => {
      expect(out).toContain('role="toolbar"');
      expect(out).toContain('aria-labelledby="title"');
    });

    it('gives the toggle buttons aria-pressed and every button an aria-label', () => {
      for (const id of ['mUnified', 'mSplit', 'only']) {
        const tag = out.slice(out.indexOf(`id="${id}"`), out.indexOf(`id="${id}"`) + 200);
        expect(tag, id).toContain('aria-pressed=');
      }
      for (const id of ['mUnified', 'mSplit', 'only', 'prev', 'next', 'helpBtn']) {
        const tag = out.slice(out.indexOf(`id="${id}"`), out.indexOf(`id="${id}"`) + 200);
        expect(tag, id).toContain('aria-label=');
      }
    });

    it('exposes the shortcut overlay as a modal dialog', () => {
      expect(out).toContain('role="dialog"');
      expect(out).toContain('aria-modal="true"');
      expect(out).toContain('aria-labelledby="helpTitle"');
      expect(out).toContain('id="helpTitle"');
      expect(out).toContain('class="help-box" tabindex="-1"'); // focusable so focus can move into the dialog
    });

    it('hides the decorative minimap and hover tooltip from assistive tech', () => {
      expect(out).toContain('id="ruler" aria-hidden="true"');
      expect(out).toContain('id="tip" aria-hidden="true"');
    });

    it('announces stat changes politely', () => {
      expect(out).toContain('id="stats" aria-live="polite"');
    });
  });
});
