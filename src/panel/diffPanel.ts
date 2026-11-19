import * as vscode from 'vscode';
import { join } from 'node:path';
import { diffMarkdown, DiffResult } from '../diff/engine';
import { blameRange } from '../git/git';
import { hash } from '../baseline/baseline';
import type { ReviewState } from '../state/reviewState';

export interface DiffRequest {
  root: string;
  rel: string;
  title: string;
  sub: string; // mô tả mốc so sánh
  working: boolean; // bên mới là file đang sửa (tự cập nhật + đánh dấu đã xem được)
  blameRev?: string; // blame bên mới tại commit này (lịch sử)
  load: () => Promise<{ old: string; new: string }>;
}

export interface PanelHost {
  state: ReviewState;
  neighbours(root: string, rel: string): { prev?: () => void; next?: () => void; pos?: string };
  pickBaseline(): void;
  setViewed(root: string, rel: string, content: string, value: boolean): void;
  onOutline(items: OutlineItem[]): void;
  onSection(i: number): void;
}

export interface OutlineItem { i: number; level: number; text: string; n: number }

const cache = new Map<string, DiffResult>();
export function cachedDiff(oldSrc: string, newSrc: string): DiffResult {
  const k = hash(oldSrc) + ':' + hash(newSrc);
  let r = cache.get(k);
  if (!r) {
    r = diffMarkdown(oldSrc, newSrc);
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
      this.panel = vscode.window.createWebviewPanel('mdReview.diff', 'MD Review', { viewColumn: vscode.ViewColumn.Active, preserveFocus },
        {
          enableScripts: true, retainContextWhenHidden: false, enableFindWidget: true,
          localResourceRoots: [this.ctx.extensionUri, vscode.Uri.file(req.root),
            ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)],
        });
      this.panel.iconPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'icon.svg');
      this.panel.onDidDispose(() => { this.panel = undefined; this.ready = false; this.host.onOutline([]); });
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
      // Không giữ chạy ngầm khi bị ẩn (vd. khi phóng to panel Terminal): ẩn thì chờ, hiện lại thì webview tự nạp lại và nhận lại dữ liệu
      this.panel.onDidChangeViewState((e) => { if (!e.webviewPanel.visible) this.ready = false; });
    } else this.panel.reveal(undefined, preserveFocus);
    this.panel.title = `Review: ${req.title}`;
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

  /** Gọi khi file thay đổi trên đĩa / đổi mốc. */
  async refresh() {
    if (this.panel && this.req) await this.render(false);
  }

  private async render(resetScroll: boolean) {
    const req = this.req!;
    const { old, new: cur } = await req.load();
    this.newContent = cur;
    const diff = cachedDiff(old, cur);
    const nb = this.host.neighbours(req.root, req.rel);
    const key = `${req.root}|${req.rel}`;
    this.post({
      type: 'render',
      resetScroll,
      data: {
        key,
        title: req.title,
        sub: req.sub,
        where: req.working ? (req.rel.includes('/') ? req.rel.slice(0, req.rel.lastIndexOf('/')) : '(thư mục gốc repo)') : req.sub,
        working: req.working,
        stats: diff.stats,
        segments: diff.segments,
        viewed: req.working ? this.host.state.isViewed(req.root, req.rel, cur) : undefined,
        seen: this.host.state.seen(req.root, req.rel),
        pos: nb.pos,
        hasPrev: !!nb.prev,
        hasNext: !!nb.next,
        prefs: this.host.state.prefs(),
        empty: old === '' ? 'Bên cũ không có file này (file mới hoặc chưa có trong mốc so sánh).' : undefined,
      },
    });
  }

  private lastRender?: any;
  private post(m: any) {
    if (m?.type === 'render') this.lastRender = m;
    if (this.ready) { void this.panel?.webview.postMessage(m); return; }
    // chỉ giữ bản render mới nhất trong hàng chờ
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
        if (/^[a-z][\w+.-]*:/i.test(href)) { void vscode.env.openExternal(vscode.Uri.parse(href)); break; }
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
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} https: data:; style-src ${w.cspSource} 'unsafe-inline'; font-src ${w.cspSource}; script-src 'nonce-${nonce}' ${w.cspSource};">
<base id="base" href="${this.baseHref(req)}">
<link rel="stylesheet" href="${u('media', 'review.css')}">
</head><body>
<header id="bar">
  <div class="title"><b id="title"></b><span id="pos" class="muted"></span></div>
  <span id="stats"></span>
  <span class="spacer"></span>
  <span class="seg-group"><button id="mUnified" class="icon" title="Xem gộp ( s )"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h4"/></svg></button><button id="mSplit" class="icon" title="Xem 2 cột trước / sau ( s )"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M8 2.5v11M3.8 6h2.4M3.8 8.5h2.4M9.8 6h2.4M9.8 8.5h2.4"/></svg></button></span>
  <button id="only" class="toggle icon" title="Hiện hết các đoạn không đổi ( c )"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 6.5 8 2l5 4.5M3 9.5 8 14l5-4.5"/></svg></button>
  <span class="nav"><button id="prev" title="Thay đổi trước ( p )">◀</button><span id="cur" class="muted"></span><button id="next" title="Thay đổi sau ( n )">▶</button></span>
  <button id="helpBtn" title="Phím tắt ( ? )">?</button>
</header>
<div id="help" hidden><div class="help-box">
  <b>Phím tắt</b>
  <table>
    <tr><td><kbd>n</kbd> / <kbd>p</kbd></td><td>Thay đổi kế tiếp / trước (ưu tiên cái chưa xem)</td></tr>
    <tr><td><kbd>x</kbd></td><td>Đánh dấu đã xem thay đổi đang chọn</td></tr>
    <tr><td><kbd>s</kbd></td><td>Gộp ↔ 2 cột</td></tr>
    <tr><td><kbd>c</kbd></td><td>Thu gọn ↔ hiện hết đoạn không đổi</td></tr>
    <tr><td><kbd>v</kbd></td><td>Đánh dấu đã xem cả file</td></tr>
    <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>File trước / sau</td></tr>
    <tr><td><kbd>?</kbd> / <kbd>Esc</kbd></td><td>Mở / đóng bảng này</td></tr>
  </table>
  <div class="muted">Rê chuột vào một đoạn ~1 giây để xem ai sửa (blame). Nút ↗ mở dòng nguồn. Mốc so sánh, mục lục, file đã xem nằm ở thanh bên MD Review.</div>
</div></div>
<main id="content"></main>
<div id="ruler"></div>
<div id="tip"></div>
<script nonce="${nonce}" src="${u('media', 'mermaid.min.js')}"></script>
<script nonce="${nonce}" src="${u('dist', 'webview.js')}"></script>
</body></html>`;
  }
}
