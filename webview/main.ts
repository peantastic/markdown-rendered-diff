// Runs inside the Review tab webview: receives diff data from the extension and renders it.
import DOMPurify from 'dompurify';
import { WEBVIEW_STRINGS, WebviewStringKey, format } from '../src/i18n/webviewStrings';

declare const acquireVsCodeApi: () => { postMessage(m: unknown): void; getState(): any; setState(s: any): void };
declare const mermaid: any;

interface Seg {
  id: string; kind: 'eq' | 'add' | 'del' | 'mod' | 'move' | 'moveSrc'; blockType: string;
  unified: string; old: string; new: string;
  newLine?: [number, number]; oldLine?: [number, number];
  heading?: { level: number; text: string }; moveFrom?: string; moveTo?: string;
}
interface Prefs { mode: 'unified' | 'split'; collapse: boolean }
interface Data {
  key: string; title: string; sub: string; working: boolean;
  stats: { add: number; del: number; mod: number; move: number };
  segments: Seg[]; viewed?: boolean; seen: string[]; pos?: string; hasPrev: boolean; hasNext: boolean;
  prefs: Prefs; empty?: string; where?: string; allowRemoteImages?: boolean;
}

// ---------- i18n ----------
const i18nEl = document.getElementById('i18n');
const I18N: { lang?: string; strings?: Partial<Record<WebviewStringKey, string>> } = i18nEl ? JSON.parse(i18nEl.textContent || '{}') : {};
const t = (k: WebviewStringKey, ...args: (string | number)[]) => format(I18N.strings?.[k] ?? WEBVIEW_STRINGS[k], ...args);
const lang = I18N.lang || undefined;

const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const content = $('content'), ruler = $('ruler'), tip = $('tip');
let data: Data | undefined;
let seen = new Set<string>();
let changeEls: HTMLElement[] = [];
let cur = -1;
const expanded = new Set<number>(); // unchanged groups the user expanded (by index of first block)
const isChange = (s: Seg) => s.kind !== 'eq';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- mermaid ----------
const dark = () => document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
let mmReady = false;
function initMermaid() {
  if (typeof mermaid === 'undefined') return;
  const fontFamily = getComputedStyle(document.body).fontFamily;
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: dark() ? 'dark' : 'default',
    fontFamily, themeVariables: { fontFamily }, flowchart: { padding: 12, useMaxWidth: true },
  });
  mmReady = true;
}
let mmSeq = 0;
const mmObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target as HTMLElement;
    mmObserver.unobserve(el);
    if (!mmReady) continue;
    const code = el.textContent ?? '';
    // wait for fonts before measuring text so node labels are not clipped
    document.fonts.ready
      .then(() => mermaid.render(`mm${++mmSeq}`, code))
      .then(({ svg }: { svg: string }) => {
        el.outerHTML = `<div class="mermaid-svg">${svg}</div>`;
        afterLayout();
      })
      .catch((err: Error) => {
        el.classList.add('mm-error');
        el.setAttribute('title', t('diagramError', err.message));
      });
  }
}, { rootMargin: '400px' });

// ---------- render ----------
function segHtml(s: Seg, i: number, split: boolean): string {
  const cls = ['seg', 'k-' + s.kind];
  if (s.heading) cls.push('hd');
  if (isChange(s) && seen.has(s.id)) cls.push('seen');
  const src = s.newLine || s.oldLine ? `<button class="g-src" title="${esc(t('openSource'))}">↗</button>` : '';
  const gutter = isChange(s)
    ? `<div class="gutter"><button class="g-seen" title="${esc(t('markSeen'))}">✓</button>${src}</div>`
    : (src ? `<div class="gutter">${src}</div>` : '');
  const sec = (x: string) => x || t('topOfFile');
  const noteText = s.moveFrom !== undefined ? t('movedFrom', sec(s.moveFrom)) : s.moveTo !== undefined ? t('movedTo', sec(s.moveTo)) : '';
  const note = noteText ? `<div class="note">${s.kind === 'move' ? '↪' : '↧'} ${esc(noteText)}</div>` : '';
  let body: string;
  if (s.kind === 'moveSrc') body = '';
  else if (split && s.kind === 'eq') body = `<div class="same">${s.new}</div>`; // unchanged: shown once across both columns
  else if (split) {
    const L = s.kind === 'add' || s.kind === 'move' ? '<div class="L empty"></div>' : `<div class="L">${s.old}</div>`;
    const R = s.kind === 'del' ? '<div class="R empty"></div>' : `<div class="R">${s.new}</div>`;
    body = `<div class="split">${L}${R}</div>`;
  } else body = s.unified;
  return `<section class="${cls.join(' ')}" data-i="${i}"${s.heading ? ` id="h${i}"` : ''}>${gutter}${note}<div class="body">${body}</div></section>`;
}

/** Unchanged blocks more than one block away from a change are folded into collapsible groups. */
function buildBody(split: boolean): string {
  const segs = data!.segments;
  const collapse = data!.prefs.collapse && segs.some(isChange);
  if (!collapse) return segs.map((x, i) => segHtml(x, i, split)).join('');
  const keep = segs.map((s, i) => isChange(s) || isChange(segs[i - 1] ?? s) || isChange(segs[i + 1] ?? s));
  let out = '';
  for (let i = 0; i < segs.length;) {
    if (keep[i]) { out += segHtml(segs[i], i, split); i++; continue; }
    let j = i;
    while (j < segs.length && !keep[j]) j++;
    const group = segs.slice(i, j);
    const heads = group.filter((s) => s.heading).map((s) => s.heading!.text);
    const open = expanded.has(i);
    const label = esc((group.length === 1 ? t('unchangedBlock') : t('unchangedBlocks', group.length)) +
      (heads.length ? t('includesSections', heads.slice(0, 4).join(', ') + (heads.length > 4 ? t('andMore', heads.length - 4) : '')) : ''));
    out += `<div class="gap${open ? ' open' : ''}" data-g="${i}"><span class="gap-label">${label}</span><span class="gap-hint">${esc(open ? t('clickToCollapse') : t('clickToExpand'))}</span></div>` +
      `<div class="gapbody" data-g="${i}"${open ? '' : ' hidden'}>${group.map((x, k) => segHtml(x, i + k, split)).join('')}</div>`;
    i = j;
  }
  return out;
}

function render(reset: boolean, restoreY?: number) {
  if (!data) return;
  const scroll = restoreY ?? (reset ? 0 : window.scrollY);
  const p = data.prefs;
  $('only').classList.toggle('on', !p.collapse);
  $('mUnified').classList.toggle('on', p.mode === 'unified');
  $('mSplit').classList.toggle('on', p.mode === 'split');
  // the file name is already on the tab -> the toolbar shows the containing folder (or the commit when viewing history)
  $('title').innerHTML = `<bdi>${esc(data.where ?? data.title)}</bdi>`;
  $('pos').textContent = data.pos ? data.pos : '';
  $('title').parentElement!.title = `${data.title}\n${data.where ?? ''}\n${t('compareWith', data.sub)}\n\n${t('pressHelp')}`;
  const s = data.stats;
  $('stats').innerHTML = [
    s.add && `<span class="pill p-add" title="${esc(t('addedBlocks'))}">+${s.add}</span>`,
    s.del && `<span class="pill p-del" title="${esc(t('removedBlocks'))}">−${s.del}</span>`,
    s.mod && `<span class="pill p-mod" title="${esc(t('modifiedBlocks'))}">~${s.mod}</span>`,
    s.move && `<span class="pill p-move" title="${esc(t('movedBlocks'))}">↕${s.move}</span>`,
  ].filter(Boolean).join('') || `<span class="muted">${esc(t('noChanges'))}</span>`;

  const split = p.mode === 'split';
  document.body.classList.toggle('split-mode', split);
  const head = split ? `<div class="split split-head"><div>${esc(t('before'))}</div><div>${esc(t('after'))}</div></div>` : '';
  const empty = data.empty ? `<div class="banner">${esc(data.empty)}</div>` : '';
  content.innerHTML = sanitize(empty + head + buildBody(split));
  localizeStatic(content);
  if (!data.allowRemoteImages) blockRemoteImages(content);
  changeEls = [...content.querySelectorAll<HTMLElement>('section.seg:not(.k-eq)')];
  if (cur >= changeEls.length) cur = -1;
  changeEls[cur]?.classList.add('focus');
  collapseTableRows();
  assignSlugs();
  postOutline();
  updateCounter();
  observeMermaid();
  requestAnimationFrame(() => { window.scrollTo(0, scroll); afterLayout(); });
}

function observeMermaid() {
  content.querySelectorAll('.mermaid-src').forEach((el) => mmObserver.observe(el));
}

/**
 * Document HTML is untrusted (raw HTML is allowed in Markdown). The CSP already blocks scripts;
 * this also removes elements that could navigate, submit or embed content, and inline event handlers.
 */
const PURIFY = {
  FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'meta', 'link', 'base', 'audio', 'video', 'source', 'track', 'portal'],
  FORBID_ATTR: ['action', 'formaction', 'srcset', 'ping', 'background', 'poster'],
  ADD_ATTR: ['hidden'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, PURIFY) as unknown as string;
}
// links never open a new browsing context from the webview
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof Element && node.hasAttribute('target')) node.removeAttribute('target');
});

/** Engine-generated labels carry data-i18n keys with English text; translate them in place. */
function localizeStatic(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n as WebviewStringKey;
    if (k in WEBVIEW_STRINGS) el.textContent = t(k);
  });
}

/** Without mdReview.allowRemoteImages the CSP blocks http(s) images; show a readable placeholder instead of a broken icon. */
function blockRemoteImages(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    if (!/^https?:/i.test(img.getAttribute('src') ?? '')) return;
    const ph = document.createElement('span');
    ph.className = 'img-blocked';
    ph.textContent = `🖼 ${img.getAttribute('alt') || img.getAttribute('src')}`;
    ph.title = t('remoteImageBlocked');
    img.replaceWith(ph);
  });
}

// ---------- tables: collapse unchanged rows + align split columns ----------
function collapseTableRows() {
  if (!data?.prefs.collapse) return;
  content.querySelectorAll<HTMLTableSectionElement>('section.k-mod tbody').forEach((tb) => {
    const rows = [...tb.rows];
    const changed = rows.map((r) => !r.classList.contains('row-eq'));
    if (!changed.some(Boolean)) return;
    const keep = changed.map((c, i) => c || changed[i - 1] || changed[i + 1]);
    const cols = Math.max(...rows.map((r) => [...r.cells].reduce((n, c) => n + (c.colSpan || 1), 0)), 1);
    for (let i = 0; i < rows.length;) {
      if (keep[i]) { i++; continue; }
      let j = i;
      while (j < rows.length && !keep[j]) j++;
      const run = rows.slice(i, j);
      run.forEach((r) => r.classList.add('row-hidden'));
      const gap = document.createElement('tr');
      gap.className = 'row-gap';
      gap.innerHTML = `<td colspan="${cols}">${esc(run.length === 1 ? t('unchangedRow') : t('unchangedRows', run.length))}</td>`;
      tb.insertBefore(gap, rows[i]);
      (gap as any)._run = run;
      i = j;
    }
  });
}

/** Split view: each left/right table row pair takes the taller height so both sides stay aligned. */
function syncSplitRows() {
  content.querySelectorAll<HTMLElement>('.split').forEach((sp) => {
    const L = sp.querySelector<HTMLElement>(':scope > .L'), R = sp.querySelector<HTMLElement>(':scope > .R');
    if (!L || !R) return;
    const lt = [...L.querySelectorAll('table')], rt = [...R.querySelectorAll('table')];
    lt.forEach((t, k) => {
      const a = [...t.rows], b = rt[k] ? [...rt[k].rows] : [];
      if (a.length !== b.length) return;
      a.forEach((r, i) => { r.style.height = ''; b[i].style.height = ''; });
      a.forEach((r, i) => {
        const h = Math.max(r.offsetHeight, b[i].offsetHeight);
        if (h) { r.style.height = `${h}px`; b[i].style.height = `${h}px`; }
      });
    });
  });
}

function afterLayout() {
  if (document.hidden || window.innerHeight < 80) return;
  syncSplitRows();
  drawRuler();
}

// ---------- outline (sent to the sidebar) ----------
let sections: { i: number; level: number; text: string; n: number }[] = [];
function postOutline() {
  if (!data) return;
  sections = [{ i: -1, level: 1, text: `(${t('topOfFile')})`, n: 0 }];
  data.segments.forEach((s, i) => {
    if (s.heading && s.kind !== 'moveSrc') sections.push({ i, level: s.heading.level, text: s.heading.text, n: 0 });
    if (isChange(s)) sections[sections.length - 1].n++;
  });
  vscode.postMessage({ type: 'outline', items: sections.filter((x) => x.n > 0) });
}

/** Expand the collapsed group containing the element, if any. */
function reveal(el: Element | null) {
  const body = el?.closest<HTMLElement>('.gapbody[hidden]');
  if (body) toggleGap(Number(body.dataset.g), true);
}
function toggleGap(g: number, open?: boolean) {
  const want = open ?? !expanded.has(g);
  if (want) expanded.add(g); else expanded.delete(g);
  const body = content.querySelector<HTMLElement>(`.gapbody[data-g="${g}"]`);
  const gap = content.querySelector<HTMLElement>(`.gap[data-g="${g}"]`);
  if (body) body.hidden = !want;
  if (gap) {
    gap.classList.toggle('open', want);
    const hint = gap.querySelector('.gap-hint');
    if (hint) hint.textContent = want ? t('clickToCollapse') : t('clickToExpand');
  }
  observeMermaid();
  requestAnimationFrame(afterLayout);
}
function scrollToSection(i: number) {
  if (i < 0) return window.scrollTo({ top: 0, behavior: 'smooth' });
  const el = document.getElementById('h' + i);
  reveal(el);
  requestAnimationFrame(() => { if (el) window.scrollTo({ top: el.offsetTop - 40, behavior: 'smooth' }); });
}
let lastSection = -2;
let scrollTimer: number | undefined;
window.addEventListener('scroll', () => {
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    if (!data || document.hidden || window.innerHeight < 80) return;
    try { vscode.setState({ key: data.key, y: window.scrollY }); } catch { /* ignore */ }
    let curSec = -1;
    for (const x of sections) {
      if (x.i < 0) continue;
      const el = document.getElementById('h' + x.i);
      if (!el || !el.offsetParent) continue;
      if (el.offsetTop - 60 <= window.scrollY) curSec = x.i; else break;
    }
    if (curSec !== lastSection) { lastSection = curSec; vscode.postMessage({ type: 'section', i: curSec }); }
  }, 150);
});

// ---------- change navigation ----------
function updateCounter() {
  const n = changeEls.length;
  const nSeen = changeEls.filter((e) => e.classList.contains('seen')).length;
  const pct = n ? Math.round((nSeen / n) * 100) : 0;
  const seenTip = esc(t('seenOf', nSeen, n));
  $('cur').innerHTML = !n ? `<span class="muted">${esc(t('noChanges'))}</span>`
    : `<span class="pos"><b>${cur >= 0 ? cur + 1 : '–'}</b><span class="muted">/${n}</span></span>` +
      `<span class="prog${nSeen === n ? ' done' : ''}" title="${seenTip}"><i style="width:${pct}%"></i></span><span class="muted" title="${seenTip}">${esc(t('seenCount', nSeen))}</span>`;
}

function drawRuler() {
  const H = document.documentElement.scrollHeight;
  ruler.innerHTML = changeEls.map((el, k) => {
    if (!el.offsetParent) return '';
    const top = (el.offsetTop / H) * 100;
    const h = Math.max((el.offsetHeight / H) * 100, 0.4);
    return `<i class="r-${el.className.match(/k-(\w+)/)![1]}${el.classList.contains('seen') ? ' seen' : ''}" data-k="${k}" style="top:${top}%;height:${h}%"></i>`;
  }).join('');
}

function go(dir: number) {
  if (!changeEls.length) return;
  // prefer changes not seen yet
  let k = cur;
  for (let step = 0; step < changeEls.length; step++) {
    k = (k + dir + changeEls.length) % changeEls.length;
    if (!changeEls[k].classList.contains('seen')) break;
    if (step === changeEls.length - 1) k = (cur + dir + changeEls.length) % changeEls.length;
  }
  focusChange(k);
}
function focusChange(k: number) {
  changeEls[cur]?.classList.remove('focus');
  cur = k;
  const el = changeEls[k];
  reveal(el);
  el.classList.add('focus');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateCounter();
}

function toggleSeen(el: HTMLElement) {
  if (!data) return;
  const s = data.segments[Number(el.dataset.i)];
  const v = !el.classList.contains('seen');
  el.classList.toggle('seen', v);
  if (v) seen.add(s.id); else seen.delete(s.id);
  vscode.postMessage({ type: 'seen', id: s.id, value: v });
  updateCounter();
  drawRuler();
}

const setPrefs = (p: Partial<Prefs>) => {
  if (!data) return;
  data.prefs = { ...data.prefs, ...p };
  vscode.postMessage({ type: 'prefs', prefs: data.prefs });
  render(false);
};

// ---------- blame on hover ----------
const blameCache = new Map<string, any>();
let hoverTimer: number | undefined;
let pendingTip: HTMLElement | undefined;
function showTip(el: HTMLElement, b: any) {
  if (!b) { tip.style.display = 'none'; return; }
  const uncommitted = /^0+$/.test(b.sha);
  const when = b.time ? new Date(b.time * 1000).toLocaleString(lang) : '';
  tip.innerHTML = uncommitted
    ? `<b>${esc(t('uncommitted'))}</b>`
    : `<b>${esc(b.author)}</b> · ${when}<br>${esc(b.summary)}<br><span class="muted">${b.sha.slice(0, 8)}${b.commits > 1 ? ` · ${esc(t('blameMore', b.commits))}` : ''}</span>`;
  const r = el.getBoundingClientRect();
  tip.style.display = 'block';
  tip.style.top = `${Math.max(r.top, 50)}px`;
  tip.style.left = `${Math.min(r.right - tip.offsetWidth - 8, window.innerWidth - tip.offsetWidth - 24)}px`;
}
content.addEventListener('mouseover', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('section.seg');
  window.clearTimeout(hoverTimer);
  if (!el || !data) { tip.style.display = 'none'; return; }
  const s = data.segments[Number(el.dataset.i)];
  if (!s.newLine || s.kind === 'moveSrc') { tip.style.display = 'none'; return; }
  hoverTimer = window.setTimeout(() => {
    const id = `${data!.key}|${s.newLine![0]}-${s.newLine![1]}|${s.id}`;
    pendingTip = el;
    if (blameCache.has(id)) return showTip(el, blameCache.get(id));
    vscode.postMessage({ type: 'blame', id, start: s.newLine![0], end: s.newLine![1] });
  }, 700);
});
content.addEventListener('mouseleave', () => { window.clearTimeout(hoverTimer); tip.style.display = 'none'; });

// ---------- links inside the document ----------
// slugs match VS Code's Markdown Preview so #anchor links work
const slug = (t: string) => t.trim().toLowerCase().replace(/\s+/g, '-')
  .replace(/[\][!'#$%&()*+,./:;<=>?@\\^{|}~`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '')
  .replace(/^-+/, '').replace(/-+$/, '');
function assignSlugs() {
  const used = new Map<string, number>();
  content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (h.closest('.L')) return; // split view: only the new side gets ids
    const base = slug(h.textContent ?? '');
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
  });
}

// ---------- keyboard shortcut overlay ----------
const help = $('help');
const toggleHelp = (v?: boolean) => { help.hidden = !(v ?? help.hidden); };
$('helpBtn').onclick = () => toggleHelp();
help.onclick = (e) => { if (e.target === help) toggleHelp(false); };

// ---------- events ----------
content.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const gap = t.closest<HTMLElement>('.gap');
  if (gap) return toggleGap(Number(gap.dataset.g));
  const rowGap = t.closest<HTMLTableRowElement>('tr.row-gap');
  if (rowGap) {
    const run: HTMLTableRowElement[] = (rowGap as any)._run ?? [];
    // split view: also expand the matching rows of the table on the other side
    const sp = rowGap.closest('.split');
    if (sp) {
      const idx = [...rowGap.parentElement!.children].indexOf(rowGap);
      sp.querySelectorAll('tbody').forEach((tb) => {
        const g = tb.children[idx] as any;
        if (g?.classList.contains('row-gap')) { (g._run ?? []).forEach((r: HTMLElement) => r.classList.remove('row-hidden')); g.remove(); }
      });
    } else {
      run.forEach((r) => r.classList.remove('row-hidden'));
      rowGap.remove();
    }
    requestAnimationFrame(afterLayout);
    return;
  }
  const a = t.closest<HTMLAnchorElement>('a[href]');
  if (a && !t.closest('.gutter')) {
    e.preventDefault();
    const href = a.getAttribute('href')!;
    if (/^\s*(javascript|vbscript|data):/i.test(href)) return;
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      const el = document.getElementById(id) ?? document.getElementById(slug(id));
      reveal(el);
      requestAnimationFrame(() => { if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 50, behavior: 'smooth' }); });
    } else vscode.postMessage({ type: 'link', href });
    return;
  }
  const sec = t.closest<HTMLElement>('section.seg');
  if (!sec || !data) return;
  if (t.closest('.g-seen')) return toggleSeen(sec);
  if (t.closest('.g-src')) {
    const s = data.segments[Number(sec.dataset.i)];
    const line = (s.newLine ?? s.oldLine)![0];
    vscode.postMessage({ type: 'openSource', line });
  }
});
ruler.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset.k) return focusChange(Number(t.dataset.k));
  const y = (e as MouseEvent).clientY / ruler.clientHeight;
  window.scrollTo({ top: y * document.documentElement.scrollHeight - window.innerHeight / 2, behavior: 'smooth' });
});
$('next').onclick = () => go(1);
$('prev').onclick = () => go(-1);
$('mUnified').onclick = () => setPrefs({ mode: 'unified' });
$('mSplit').onclick = () => setPrefs({ mode: 'split' });
$('only').onclick = () => setPrefs({ collapse: !data?.prefs.collapse });
let resizeTimer: number | undefined;
window.addEventListener('resize', () => { window.clearTimeout(resizeTimer); resizeTimer = window.setTimeout(afterLayout, 120); });
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === 'Escape') { toggleHelp(false); return; }
  if (k === '?') toggleHelp();
  else if (k === 'n' || k === 'j') go(1);
  else if (k === 'p' || k === 'k') go(-1);
  else if (k === 'x' && changeEls[cur]) toggleSeen(changeEls[cur]);
  else if (k === 's') setPrefs({ mode: data?.prefs.mode === 'split' ? 'unified' : 'split' });
  else if (k === 'c') setPrefs({ collapse: !data?.prefs.collapse });
  else if (k === 'v' && data?.working) vscode.postMessage({ type: 'toggleViewed' });
  else if (k === ']') vscode.postMessage({ type: 'nav', dir: 1 });
  else if (k === '[') vscode.postMessage({ type: 'nav', dir: -1 });
  else return;
  e.preventDefault();
});

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'render') {
    // first render after the webview was reloaded -> restore the saved scroll position
    const st = !data ? vscode.getState() : undefined;
    const restoreY = st && st.key === m.data.key && !m.resetScroll ? st.y : undefined;
    const reset = m.resetScroll || (data !== undefined && data.key !== m.data.key);
    if (reset) { cur = -1; expanded.clear(); }
    data = m.data;
    data!.prefs = { mode: 'unified', collapse: true, ...(m.data.prefs ?? {}) };
    seen = new Set(data!.seen);
    render(reset, restoreY);
  } else if (m.type === 'blame') {
    blameCache.set(m.id, m.blame);
    if (pendingTip) showTip(pendingTip, m.blame);
  } else if (m.type === 'scrollTo') {
    scrollToSection(m.i);
  } else if (m.type === 'base') {
    $<HTMLBaseElement>('base').href = m.base;
  }
});

initMermaid();
new MutationObserver(() => { initMermaid(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
vscode.postMessage({ type: 'ready' });
