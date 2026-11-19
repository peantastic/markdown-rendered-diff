import MarkdownIt from 'markdown-it';
import katex from '@vscode/markdown-it-katex';
import footnote from 'markdown-it-footnote';
import githubAlerts from 'markdown-it-github-alerts';
import { textOf } from './tokenize';

const make = (html: boolean) =>
  new MarkdownIt('commonmark', { html })
    .enable(['table', 'strikethrough'])
    // KaTeX math ($…$, $$…$$); throwOnError:false renders bad LaTeX as inline error, never breaking the block
    .use(katex, { throwOnError: false })
    .use(footnote)
    .use(githubAlerts);
/** Renderer with raw HTML enabled (default) and one that escapes it (untrusted workspaces / mdReview.renderHtml = false). */
export const md = make(true);
const mdHtml = md;
const mdNoHtml = make(false);
type Md = typeof md;
type Token = ReturnType<Md['parse']>[number];

export interface ParseOptions { html?: boolean }

export interface Cell { tag: 'th' | 'td'; attrs: string; html: string }
export type Row = Cell[];
/** Common table model for Markdown tables (| a | b |) and raw HTML tables (<table>…). */
export interface TableData {
  open: string; // opening <table …> tag (keeps attributes)
  colgroup: string;
  head: Row[];
  body: Row[];
  pre: string; // HTML before/after the table inside the same block
  post: string;
}

export interface Block {
  type: string; // paragraph | heading | table | fence | mermaid | bullet_list | ...
  key: string; // source text used for comparison
  html: string;
  line: [number, number] | null; // source lines [start, end) (0-based)
  heading?: { level: number; text: string };
  table?: TableData;
  mermaid?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Leading YAML front matter -> fenced code block (line count preserved so line numbers stay correct). */
function normalizeSource(src: string): string {
  src = src.normalize('NFC').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?\n)---\n/.exec(src);
  if (m) src = '```yaml\n' + m[1] + '```\n' + src.slice(m[0].length);
  return src;
}

function parseMdTable(md: Md, toks: Token[], env: any): TableData {
  const t: TableData = { open: '<table>', colgroup: '', head: [], body: [], pre: '', post: '' };
  let row: Row | null = null;
  let inHead = false;
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    if (k.type === 'thead_open') inHead = true;
    else if (k.type === 'thead_close') inHead = false;
    else if (k.type === 'tr_open') row = [];
    else if (k.type === 'tr_close' && row) {
      (inHead ? t.head : t.body).push(row);
      row = null;
    } else if ((k.type === 'th_open' || k.type === 'td_open') && row) {
      const style = k.attrGet('style');
      const inline = toks[i + 1];
      row.push({
        tag: k.type === 'th_open' ? 'th' : 'td',
        attrs: style ? ` style="${style}"` : '',
        html: inline?.type === 'inline' ? md.renderer.renderInline(inline.children ?? [], md.options, env) : '',
      });
    }
  }
  return t;
}

const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

/** Raw HTML table inside an html_block. Returns undefined when unsure (several tables, nested tables…). */
export function parseHtmlTable(html: string): TableData | undefined {
  if ((html.match(/<table\b/gi) ?? []).length !== 1) return undefined;
  const s = html.search(/<table\b/i);
  const e = html.search(/<\/table\s*>/i);
  if (s < 0 || e < s) return undefined;
  const endTag = /<\/table\s*>/i.exec(html.slice(e))![0];
  const inner = html.slice(s, e);
  const open = /^<table\b[^>]*>/i.exec(inner)?.[0];
  if (!open) return undefined;
  let rest = inner.slice(open.length);
  const colgroup = /<colgroup\b[\s\S]*?<\/colgroup>/i.exec(rest)?.[0] ?? '';
  rest = rest.replace(colgroup, '');
  const rowsOf = (x: string): Row[] =>
    [...x.matchAll(ROW_RE)].map((m) =>
      [...m[1].matchAll(CELL_RE)].map((c) => ({ tag: c[1].toLowerCase() as 'th' | 'td', attrs: c[2], html: c[3] })));
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(rest);
  const head = thead ? rowsOf(thead[1]) : [];
  const body = rowsOf(thead ? rest.replace(thead[0], '') : rest);
  if ([...head, ...body].some((r) => r.some((c) => /<t[dhr]\b/i.test(c.html)))) return undefined;
  if (head.length + body.length === 0) return undefined;
  return { open, colgroup, head, body, pre: html.slice(0, s), post: html.slice(e + endTag.length) };
}

export function renderRow(r: Row, cls = ''): string {
  return `<tr${cls ? ` class="${cls}"` : ''}>` + r.map((c) => `<${c.tag}${c.attrs}>${c.html}</${c.tag}>`).join('') + '</tr>';
}

export function renderTable(t: TableData): string {
  return (
    t.pre + t.open + t.colgroup +
    (t.head.length ? '<thead>' + t.head.map((r) => renderRow(r)).join('') + '</thead>' : '') +
    '<tbody>' + t.body.map((r) => renderRow(r)).join('') + '</tbody></table>' + t.post
  );
}

export function mermaidHtml(code: string): string {
  return `<div class="mermaid-box"><pre class="mermaid-src">${escapeHtml(code)}</pre></div>`;
}

export function parseBlocks(source: string, opts: ParseOptions = {}): Block[] {
  const md = opts.html === false ? mdNoHtml : mdHtml;
  const src = normalizeSource(source);
  const lines = src.split('\n');
  const env: any = {};
  const toks = md.parse(src, env);
  const out: Block[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    let j = i;
    if (t.nesting === 1) {
      let depth = 0;
      for (; j < toks.length; j++) {
        depth += toks[j].nesting;
        if (depth === 0) break;
      }
    }
    const seg = toks.slice(i, j + 1);
    const line = t.map ? ([t.map[0], t.map[1]] as [number, number]) : null;
    const key = line ? lines.slice(line[0], line[1]).join('\n').trim() : t.content;
    const type = t.type.replace(/_open$/, '');
    const b: Block = { type, key, html: '', line };

    if (t.type === 'fence' && t.info.trim().toLowerCase() === 'mermaid') {
      b.type = 'mermaid';
      b.mermaid = t.content;
      b.html = mermaidHtml(t.content);
    } else if (t.type === 'table_open') {
      b.table = parseMdTable(md, seg, env);
      b.html = renderTable(b.table);
    } else if (t.type === 'html_block' && /<table\b/i.test(t.content) && (b.table = parseHtmlTable(t.content))) {
      b.type = 'table';
      b.html = t.content; // keep the original HTML when unchanged
    } else {
      b.html = md.renderer.render(seg, md.options, env);
      if (t.type === 'heading_open') {
        b.heading = { level: Number(t.tag.slice(1)), text: textOf(b.html) };
      }
    }
    out.push(b);
    i = j + 1;
  }
  return out;
}
