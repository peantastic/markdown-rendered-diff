import type { WebviewStrings } from '../i18n/webviewStrings';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
  unified: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h4"/></svg>',
  split: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M8 2.5v11M3.8 6h2.4M3.8 8.5h2.4M9.8 6h2.4M9.8 8.5h2.4"/></svg>',
  expand: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 6.5 8 2l5 4.5M3 9.5 8 14l5-4.5"/></svg>',
};

/**
 * Static body of the Review page (toolbar, shortcut overlay, containers).
 * Pure function so the screenshot harness renders exactly the same markup as the extension.
 */
export function pageBody(t: WebviewStrings): string {
  const row = (keys: string, text: string) => `<tr><td>${keys}</td><td>${esc(text)}</td></tr>`;
  const k = (s: string) => `<kbd>${s}</kbd>`;
  return `<header id="bar" role="toolbar" aria-labelledby="title">
  <div class="title"><b id="title"></b><span id="pos" class="muted"></span></div>
  <span id="stats" aria-live="polite"></span>
  <span class="spacer"></span>
  <span class="seg-group" role="group"><button id="mUnified" class="icon" aria-pressed="true" aria-label="${esc(t.viewUnified)}" title="${esc(t.viewUnified)}">${ICON.unified}</button><button id="mSplit" class="icon" aria-pressed="false" aria-label="${esc(t.viewSplit)}" title="${esc(t.viewSplit)}">${ICON.split}</button></span>
  <button id="only" class="toggle icon" aria-pressed="false" aria-label="${esc(t.showAll)}" title="${esc(t.showAll)}">${ICON.expand}</button>
  <span class="nav"><button id="prev" aria-label="${esc(t.prevChange)}" title="${esc(t.prevChange)}">◀</button><span id="cur" class="muted"></span><button id="next" aria-label="${esc(t.nextChange)}" title="${esc(t.nextChange)}">▶</button></span>
  <button id="helpBtn" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(t.shortcutsButton)}" title="${esc(t.shortcutsButton)}">?</button>
</header>
<div id="help" hidden role="dialog" aria-modal="true" aria-labelledby="helpTitle"><div class="help-box" tabindex="-1">
  <b id="helpTitle">${esc(t.shortcuts)}</b>
  <table>
    ${row(`${k('n')} / ${k('p')}`, t.keyNextPrev)}
    ${row(k('x'), t.keySeen)}
    ${row(k('a'), t.keyAskAi)}
    ${row(k('s'), t.keySplit)}
    ${row(k('c'), t.keyCollapse)}
    ${row(k('v'), t.keyViewed)}
    ${row(`${k('[')} / ${k(']')}`, t.keyFiles)}
    ${row(`${k('?')} / ${k('Esc')}`, t.keyHelp)}
  </table>
  <div class="muted">${esc(t.helpFooter)}</div>
</div></div>
<main id="content"></main>
<div id="ruler" aria-hidden="true"></div>
<div id="tip" aria-hidden="true"></div>`;
}

/** JSON island read by the webview script; `<` is escaped so the content cannot close the script tag. */
export function i18nScript(lang: string, strings: WebviewStrings): string {
  return `<script type="application/json" id="i18n">${JSON.stringify({ lang, strings }).replace(/</g, '\\u003c')}</script>`;
}
