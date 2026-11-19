import * as vscode from 'vscode';
import { join } from 'node:path';
import { diffMarkdown, DiffResult } from '../diff/engine';
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

const cache = new Map<string, DiffResult>();
export function cachedDiff(oldSrc: string, newSrc: string, html = true): DiffResult {
  const k = hash(oldSrc) + ':' + hash(newSrc) + (html ? '' : ':nohtml');
  let r = cache.get(k);
  if (!r) {
    r = diffMarkdown(oldSrc, newSrc, { html });
    if (cache.size > 200) cache.clear();
    cache.set(k, r);
  }
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

  private async onMessage(m: any) {
    const req = this.req;
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
        if (req) this.host.setViewed(req.root, req.rel, this.newContent, m.value);
        break;
      case 'prefs':
        this.host.state.setPrefs(m.prefs);
        break;
      case 'openSource': {
        if (!req) break;
        const uri = vscode.Uri.file(join(req.root, req.rel));
        const pos = new vscode.Position(m.line, 0);
        await vscode.window.showTextDocument(uri, { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.Beside });
        break;
      }
      case 'blame': {
        if (!req) break;
        const b = await blameRange(req.root, req.rel, m.start + 1, m.end, req.blameRev);
        void this.panel?.webview.postMessage({ type: 'blame', id: m.id, blame: b });
        break;
      }
      case 'nav': {
        if (!req) break;
        const nb = this.host.neighbours(req.root, req.rel);
        (m.dir > 0 ? nb.next : nb.prev)?.();
        break;
      }
      case 'link': {
        if (!req) break;
        const href: string = m.href;
        if (/^[a-z][\w+.-]*:/i.test(href)) {
          // only open web/mail links externally; never command:, file:, vscode: … from document content
          if (/^(https?|mailto):/i.test(href)) void vscode.env.openExternal(vscode.Uri.parse(href));
          break;
        }
        const [path, frag] = decodeURI(href).split('#');
        const target = vscode.Uri.file(join(req.root, req.rel, '..', path));
        if (/\.(md|markdown)$/i.test(path)) void vscode.commands.executeCommand('mdReview.open', target);
        else void vscode.commands.executeCommand('vscode.open', target);
        void frag;
        break;
      }
      case 'outline':
        this.host.onOutline(m.items);
        break;
      case 'section':
        if (this.panel?.visible) this.host.onSection(m.i);
        break;
      case 'toggleViewed':
        void vscode.commands.executeCommand('mdReview.toggleViewed');
        break;
      case 'pickBaseline':
        this.host.pickBaseline();
        break;
    }
  }

  private baseHref(req: DiffRequest) {
    const dir = vscode.Uri.file(join(req.root, req.rel, '..'));
    return this.panel!.webview.asWebviewUri(dir).toString() + '/';
  }

  private html(req: DiffRequest): string {
    const w = this.panel!.webview;
    const u = (...p: string[]) => w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, ...p)).toString();
    const nonce = hash(String(Math.random()) + Date.now());
    const remote = this.host.allowRemoteImages() ? ' https:' : '';
    return `<!doctype html><html lang="${vscode.env.language}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:${remote}; style-src ${w.cspSource} 'unsafe-inline'; font-src ${w.cspSource}; script-src 'nonce-${nonce}' ${w.cspSource};">
<base id="base" href="${this.baseHref(req)}">
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
