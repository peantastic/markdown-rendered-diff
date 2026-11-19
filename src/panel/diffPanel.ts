import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { diffMarkdown, DiffResult, Segment } from '../diff/engine';
import { askAiAboutChange } from '../ai/askAi';
import { blameRange } from '../git/git';
import { hash } from '../baseline/baseline';
import { WEBVIEW_STRINGS, WebviewStringKey, WebviewStrings } from '../i18n/webviewStrings';
import { i18nScript, pageBody } from './pageHtml';
import type { ReviewState } from '../state/reviewState';

export interface DiffRequest {
  root: string;
  rel: string;
  title: string;
  sub: string; // baseline description
  working: boolean; // new side is the working file (live updates, can be marked viewed)
  blameRev?: string; // blame the new side at this commit (history view)
  load: () => Promise<{ old: string; new: string }>;
}

export interface PanelHost {
  state: ReviewState;
  neighbours(root: string, rel: string): { prev?: () => void; next?: () => void; pos?: string };
  pickBaseline(): void;
  setViewed(root: string, rel: string, content: string, value: boolean): void;
  onOutline(items: OutlineItem[]): void;
  onSection(i: number): void;
  /** false in untrusted workspaces or when mdReview.renderHtml is off */
  renderHtml(): boolean;
  allowRemoteImages(): boolean;
}

export interface OutlineItem { i: number; level: number; text: string; n: number }

export const CACHE_MAX = 200;
const cache = new Map<string, DiffResult>();
export function cachedDiff(oldSrc: string, newSrc: string, html = true): DiffResult {
  const k = hash(oldSrc) + ':' + hash(newSrc) + (html ? '' : ':nohtml');
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k); // move to most-recently-used
    cache.set(k, hit);
    return hit;
  }
  const r = diffMarkdown(oldSrc, newSrc, { html });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!); // evict least-recently-used
  cache.set(k, r);
  return r;
}

export class DiffPanel {
  private panel?: vscode.WebviewPanel;
  private req?: DiffRequest;
  private newContent = '';
  private ready = false;

  constructor(private ctx: vscode.ExtensionContext, private host: PanelHost) {}

  get current() { return this.req; }

  async show(req: DiffRequest, preserveFocus = false) {
    const sameFile = this.req && this.req.root === req.root && this.req.rel === req.rel;
    this.req = req;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('mdReview.diff', 'Markdown Rendered Diff', { viewColumn: vscode.ViewColumn.Active, preserveFocus },
        {
          enableScripts: true, retainContextWhenHidden: false, enableFindWidget: true,
          localResourceRoots: [this.ctx.extensionUri, vscode.Uri.file(req.root),
            ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)],
        });
      this.panel.iconPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'icon.svg');
      this.panel.onDidDispose(() => { this.panel = undefined; this.ready = false; this.host.onOutline([]); });
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
      // Not retained while hidden (e.g. when the terminal panel is maximized): when shown again the webview reloads and receives the last render
      this.panel.onDidChangeViewState((e) => { if (!e.webviewPanel.visible) this.ready = false; });
    } else this.panel.reveal(undefined, preserveFocus);
    this.panel.title = vscode.l10n.t('Review: {0}', req.title);
    if (!this.ready || !sameFile) {
      if (!this.ready) this.panel.webview.html = this.html(req);
      else this.post({ type: 'base', base: this.baseHref(req) });
    }
    await this.render(!sameFile);
  }

  scrollTo(i: number) {
    this.panel?.reveal(undefined, true);
    void this.panel?.webview.postMessage({ type: 'scrollTo', i });
  }

  /** Called when the file changes on disk or the baseline changes. */
  async refresh() {
    if (this.panel && this.req) await this.render(false);
  }

  private async render(resetScroll: boolean) {
    const req = this.req!;
    const { old, new: cur } = await req.load();
    this.newContent = cur;
    const diff = cachedDiff(old, cur, this.host.renderHtml());
    const nb = this.host.neighbours(req.root, req.rel);
    const key = `${req.root}|${req.rel}`;
    this.post({
      type: 'render',
      resetScroll,
      data: {
        key,
        title: req.title,
        sub: req.sub,
        where: req.working ? (req.rel.includes('/') ? req.rel.slice(0, req.rel.lastIndexOf('/')) : vscode.l10n.t('(repository root)')) : req.sub,
        working: req.working,
        stats: diff.stats,
        segments: diff.segments,
        viewed: req.working ? this.host.state.isViewed(req.root, req.rel, cur) : undefined,
        seen: this.host.state.seen(req.root, req.rel),
        pos: nb.pos,
        hasPrev: !!nb.prev,
        hasNext: !!nb.next,
        prefs: this.host.state.prefs(),
        empty: old === '' ? webviewStrings().notInBaseline : undefined,
        allowRemoteImages: this.host.allowRemoteImages(),
      },
    });
  }

  private lastRender?: any;
  private post(m: any) {
    if (m?.type === 'render') this.lastRender = m;
    if (this.ready) { void this.panel?.webview.postMessage(m); return; }
    // keep only the latest render in the queue
    if (m?.type === 'render') this.pending = this.pending.filter((p: any) => p?.type !== 'render');
    this.pending.push(m);
  }
  private pending: unknown[] = [];

  /**
   * Messages from the webview are treated as untrusted input: the page renders document content,
   * so every field is type-checked and paths are confined to the repository.
   */
  private async onMessage(m: any) {
    const req = this.req;
    if (!m || typeof m.type !== 'string') return;
    const int = (v: unknown, max = 10_000_000) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : undefined);
    switch (m.type) {
      case 'ready':
        this.ready = true;
        if (!this.pending.some((p: any) => p?.type === 'render') && this.lastRender) {
          this.pending.push({ ...this.lastRender, resetScroll: false });
        }
        for (const p of this.pending.splice(0)) void this.panel?.webview.postMessage(p);
        break;
      case 'seen':
        if (req) this.host.state.setSeen(req.root, req.rel, m.id, m.value);
        break;
      case 'viewed':
        if (req?.working && typeof m.value === 'boolean') this.host.setViewed(req.root, req.rel, this.newContent, m.value);
        break;
      case 'prefs':
        this.host.state.setPrefs(m.prefs);
        break;
      case 'openSource': {
        const line = int(m.line);
        if (!req || line === undefined) break;
        const uri = vscode.Uri.file(join(req.root, req.rel));
        const pos = new vscode.Position(line, 0);
        await vscode.window.showTextDocument(uri, { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.Beside });
        break;
      }
      case 'blame': {
        const start = int(m.start), end = int(m.end);
        if (!req || start === undefined || end === undefined || typeof m.id !== 'string' || m.id.length > 300) break;
        const b = await blameRange(req.root, req.rel, start + 1, end, req.blameRev);
        void this.panel?.webview.postMessage({ type: 'blame', id: m.id, blame: b });
        break;
      }
      case 'nav': {
        if (!req || (m.dir !== 1 && m.dir !== -1)) break;
        const nb = this.host.neighbours(req.root, req.rel);
        (m.dir > 0 ? nb.next : nb.prev)?.();
        break;
      }
      case 'link':
        if (req && typeof m.href === 'string' && m.href.length < 4096) this.openLink(req, m.href);
        break;
      case 'outline':
        if (Array.isArray(m.items)) {
          this.host.onOutline(m.items.slice(0, 5000).filter((x: any) =>
            x && Number.isInteger(x.i) && Number.isInteger(x.level) && Number.isInteger(x.n) && typeof x.text === 'string')
            .map((x: any) => ({ i: x.i, level: x.level, n: x.n, text: x.text.slice(0, 500) })));
        }
        break;
      case 'section':
        if (this.panel?.visible && Number.isInteger(m.i)) this.host.onSection(m.i);
        break;
      case 'toggleViewed':
        void vscode.commands.executeCommand('mdReview.toggleViewed');
        break;
      case 'pickBaseline':
        this.host.pickBaseline();
        break;
      case 'askAi': {
        const i = int(m.i, 1_000_000);
        const segs = this.lastRender?.data?.segments as Segment[] | undefined;
        const seg = i !== undefined ? segs?.[i] : undefined;
        if (!req || !seg || seg.kind === 'eq') break;
        const { old, new: cur } = await req.load();
        const slice = (src: string, r?: [number, number]) => (r ? src.split('\n').slice(r[0], r[1]).join('\n') : '');
        let section = '';
        for (let k = i!; k >= 0; k--) { if (segs![k].heading) { section = segs![k].heading!.text; break; } }
        await askAiAboutChange({
          root: req.root,
          rel: req.rel,
          line: seg.newLine?.[0] ?? seg.oldLine?.[0],
          section,
          kind: seg.kind,
          oldText: slice(old, seg.oldLine),
          newText: slice(cur, seg.newLine),
        });
        break;
      }
    }
  }

  /** Links clicked inside the document: web/mail links open externally, relative links only inside the repository. */
  private openLink(req: DiffRequest, href: string) {
    if (/^[a-z][\w+.-]*:/i.test(href)) {
      // never command:, file:, vscode:, javascript: … coming from document content
      if (/^(https?|mailto):/i.test(href)) void vscode.env.openExternal(vscode.Uri.parse(href, true));
      return;
    }
    let path: string;
    try { path = decodeURIComponent(href.split('#')[0].split('?')[0]); } catch { return; }
    if (!path || path.includes('\0')) return;
    const abs = path.startsWith('/') ? join(req.root, path) : resolve(req.root, dirname(req.rel), path);
    const rel = relative(req.root, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Links outside the repository are not opened from the Review tab.'));
      return;
    }
    const target = vscode.Uri.file(abs);
    if (/\.(md|markdown)$/i.test(abs)) void vscode.commands.executeCommand('mdReview.open', target);
    else void vscode.commands.executeCommand('vscode.open', target);
  }

  private baseHref(req: DiffRequest) {
    const dir = vscode.Uri.file(join(req.root, req.rel, '..'));
    return this.panel!.webview.asWebviewUri(dir).toString() + '/';
  }

  private html(req: DiffRequest): string {
    const w = this.panel!.webview;
    const u = (...p: string[]) => w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, ...p)).toString();
    const nonce = randomBytes(18).toString('base64');
    const remote = this.host.allowRemoteImages() ? ' https:' : '';
    return `<!doctype html><html lang="${vscode.env.language}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:${remote}; style-src ${w.cspSource} 'unsafe-inline'; font-src ${w.cspSource}; script-src 'nonce-${nonce}'; base-uri ${w.cspSource}; form-action 'none'; frame-src 'none'; object-src 'none';">
<base id="base" href="${this.baseHref(req)}">
<link rel="stylesheet" href="${u('media', 'katex', 'katex.min.css')}">
<link rel="stylesheet" href="${u('media', 'review.css')}">
</head><body>
${pageBody(webviewStrings())}
${i18nScript(vscode.env.language, webviewStrings()).replace('<script ', `<script nonce="${nonce}" `)}
<script nonce="${nonce}" src="${u('media', 'mermaid.min.js')}"></script>
<script nonce="${nonce}" src="${u('dist', 'webview.js')}"></script>
</body></html>`;
  }
}

/** Translate the webview string table with the active VS Code language bundle (English text is the key). */
function webviewStrings(): WebviewStrings {
  const bundle = vscode.l10n.bundle ?? {};
  const out = {} as WebviewStrings;
  for (const [k, en] of Object.entries(WEBVIEW_STRINGS) as [WebviewStringKey, string][]) {
    const v = bundle[en];
    out[k] = typeof v === 'string' ? v : (v as { message?: string } | undefined)?.message ?? en;
  }
  return out;
}
