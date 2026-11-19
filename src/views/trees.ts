import * as vscode from 'vscode';
import { join } from 'node:path';
import { basename, dirname } from 'node:path/posix'; // repo-relative paths always use '/'
import { existsSync } from 'node:fs';
import { Baselines, hash, readText } from '../baseline/baseline';
import type { Baseline } from '../baseline/baseline';
import { Commit, fileHistory } from '../git/git';
import { cachedDiff } from '../panel/diffPanel';
import type { DiffStats } from '../diff/engine';
import type { ReviewState } from '../state/reviewState';

export interface FileNode { kind: 'file'; root: string; rel: string }
interface RepoNode { kind: 'repo'; root: string }
interface FolderNode { kind: 'folder'; root: string; path: string; label: string }
type Node = FileNode | RepoNode | FolderNode;

export type FileStatus = 'M' | 'A' | 'D';
const STATUS: Record<FileStatus, { label: () => string; color: string }> = {
  M: { label: () => vscode.l10n.t('Modified'), color: 'gitDecoration.modifiedResourceForeground' },
  A: { label: () => vscode.l10n.t('Added'), color: 'gitDecoration.addedResourceForeground' },
  D: { label: () => vscode.l10n.t('Deleted'), color: 'gitDecoration.deletedResourceForeground' },
};
// synthetic URI (hash of repo root + '/' + relative path) — works for Windows paths too
const statusPath = (root: string, rel: string) => `/${hash(root)}/${rel}`;
const statusUri = (root: string, rel: string) => vscode.Uri.from({ scheme: 'md-review', path: statusPath(root, rel) });

/** Coloured M/A/D badge for files in the tree (files only — not propagated to folders like git decorations). */
export class StatusDecorations implements vscode.FileDecorationProvider {
  private emitter = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  readonly status = new Map<string, FileStatus>(); // key = statusPath()
  set(root: string, rel: string, st: FileStatus) {
    this.status.set(statusPath(root, rel), st);
    this.emitter.fire([statusUri(root, rel)]);
  }
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'md-review') return undefined;
    const st = this.status.get(uri.path);
    if (!st) return undefined;
    return { badge: st, tooltip: STATUS[st].label(), color: new vscode.ThemeColor(STATUS[st].color), propagate: false };
  }
}

/** Changed Markdown files for the current baseline (flat list or folder tree). */
export class ChangesTree implements vscode.TreeDataProvider<Node> {
  private emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private files = new Map<string, string[]>(); // root -> rel[]
  private stats = new Map<string, DiffStats>();
  private gen = 0;
  view?: vscode.TreeView<Node>;
  treeMode = true;
  readonly decorations = new StatusDecorations();

  constructor(
    private roots: () => string[],
    private baselines: Baselines,
    private state: ReviewState,
    private baseline: () => Baseline,
    private renderHtml: () => boolean = () => true,
  ) {}

  setTreeMode(v: boolean) {
    this.treeMode = v;
    this.emitter.fire(undefined);
  }

  /** Flat list in display order — used for previous/next file. */
  flat(): FileNode[] {
    const out: FileNode[] = [];
    const walk = (n?: Node) => {
      for (const c of this.getChildren(n)) {
        if (c.kind === 'file') out.push(c);
        else walk(c);
      }
    };
    walk();
    return out;
  }

  async reload() {
    const g = ++this.gen;
    const b = this.baseline();
    const res = new Map<string, string[]>();
    await Promise.all(this.roots().map(async (r) => res.set(r, await this.baselines.listFiles(r, b))));
    if (g !== this.gen) return;
    this.files = res;
    this.stats.clear();
    this.emitter.fire(undefined);
    this.updateDescription();
    // compute +/−/~ in the background, 4 files at a time
    const queue = this.flat();
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        if (g !== this.gen) return;
        const old = await this.baselines.oldContent(f.root, f.rel, b);
        const abs = join(f.root, f.rel);
        const d = cachedDiff(old, readText(abs), this.renderHtml());
        this.stats.set(`${f.root}|${f.rel}`, d.stats);
        this.decorations.set(f.root, f.rel, !existsSync(abs) ? 'D' : old === '' ? 'A' : 'M');
        this.emitter.fire(f);
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  private viewed(root: string, rel: string) {
    return this.state.isViewed(root, rel, readText(join(root, rel)));
  }

  updateDescription() {
    if (!this.view) return;
    const all = this.flat();
    const viewed = all.filter((f) => this.viewed(f.root, f.rel)).length;
    this.view.description = all.length ? vscode.l10n.t('{0}/{1} viewed', viewed, all.length) : '';
    this.view.message = all.length || !this.roots().length ? undefined : vscode.l10n.t('No changed Markdown files — baseline: {0}', this.baselines.label(this.baseline()));
  }

  refreshItem(_n?: FileNode) {
    // refresh the whole tree so parent folder "viewed" counts update too
    this.emitter.fire(undefined);
    this.updateDescription();
  }

  // ---------- folder tree ----------
  private listUnder(root: string, prefix: string) {
    const dirs = new Set<string>();
    const direct: string[] = [];
    for (const rel of this.files.get(root) ?? []) {
      if (!rel.startsWith(prefix)) continue;
      const rest = rel.slice(prefix.length);
      const i = rest.indexOf('/');
      if (i < 0) direct.push(rel);
      else dirs.add(prefix + rest.slice(0, i));
    }
    return { dirs: [...dirs].sort(), direct: direct.sort() };
  }
  /** Merge chains of single-child folders (like Source Control's "compact folders"). */
  private compact(root: string, dir: string): string {
    for (;;) {
      const { dirs, direct } = this.listUnder(root, dir + '/');
      if (direct.length === 0 && dirs.length === 1) dir = dirs[0];
      else return dir;
    }
  }
  private under(root: string, prefix: string): Node[] {
    const { dirs, direct } = this.listUnder(root, prefix);
    return [
      ...dirs.map((d): FolderNode => {
        const c = this.compact(root, d);
        return { kind: 'folder', root, path: c, label: c.slice(prefix.length) };
      }),
      ...direct.map((rel): FileNode => ({ kind: 'file', root, rel })),
    ];
  }
  private rootChildren(root: string): Node[] {
    if (this.treeMode) return this.under(root, '');
    return (this.files.get(root) ?? []).map((rel): FileNode => ({ kind: 'file', root, rel }));
  }

  getChildren(n?: Node): Node[] {
    const roots = this.roots();
    if (!n) {
      if (roots.length === 1) return this.rootChildren(roots[0]);
      return roots.filter((r) => (this.files.get(r) ?? []).length).map((root): RepoNode => ({ kind: 'repo', root }));
    }
    if (n.kind === 'repo') return this.rootChildren(n.root);
    if (n.kind === 'folder') return this.under(n.root, n.path + '/');
    return [];
  }

  getParent(n: Node): Node | undefined {
    if (n.kind === 'repo') return undefined;
    const top: Node | undefined = this.roots().length > 1 ? { kind: 'repo', root: n.root } : undefined;
    if (!this.treeMode) return top;
    const target = n.kind === 'file' ? n.rel : n.path;
    let parent: Node | undefined = top;
    let prefix = '';
    for (;;) {
      const next = this.under(n.root, prefix).find((c): c is FolderNode => c.kind === 'folder' && target.startsWith(c.path + '/'));
      if (!next) return parent;
      parent = next;
      prefix = next.path + '/';
    }
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === 'repo') {
      const it = new vscode.TreeItem(basename(n.root), vscode.TreeItemCollapsibleState.Expanded);
      it.id = `repo:${n.root}`;
      it.iconPath = new vscode.ThemeIcon('repo');
      it.description = vscode.l10n.t('{0} files', this.files.get(n.root)?.length ?? 0);
      return it;
    }
    if (n.kind === 'folder') {
      const it = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.Expanded);
      it.id = `${n.root}|dir:${n.path}`;
      const files = (this.files.get(n.root) ?? []).filter((r) => r.startsWith(n.path + '/'));
      const v = files.filter((r) => this.viewed(n.root, r)).length;
      it.description = `${v}/${files.length}`;
      it.tooltip = `${n.path}\n${vscode.l10n.t('{0}/{1} files viewed', v, files.length)}`;
      it.contextValue = 'mdFolder';
      return it;
    }
    const it = new vscode.TreeItem(basename(n.rel));
    const s = this.stats.get(`${n.root}|${n.rel}`);
    const dir = dirname(n.rel) === '.' ? '' : dirname(n.rel);
    const st = s ? [s.add && `+${s.add}`, s.del && `−${s.del}`, s.mod && `~${s.mod}`, s.move && `↕${s.move}`].filter(Boolean).join(' ') : '…';
    it.description = this.treeMode ? st : `${st}  ·  ${dir}`;
    const fst = this.decorations.status.get(statusPath(n.root, n.rel));
    it.tooltip = `${basename(n.rel)}\n${n.rel}${fst ? `\n${STATUS[fst].label()}` : ''}\n\n${vscode.l10n.t('Blocks: {0} added · {1} removed · {2} modified · {3} moved', s?.add ?? '?', s?.del ?? '?', s?.mod ?? '?', s?.move ?? '?')}`;
    it.iconPath = new vscode.ThemeIcon('markdown');
    it.resourceUri = statusUri(n.root, n.rel); // shows the M/A/D badge
    it.id = `${n.root}|${n.rel}`;
    it.checkboxState = this.viewed(n.root, n.rel)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    it.command = { command: 'mdReview.openFile', title: vscode.l10n.t('Open'), arguments: [n] };
    it.contextValue = 'mdFile';
    return it;
  }
}

interface CommitNode { root: string; rel: string; c: Commit }

/** Commit history of the file being reviewed. */
export class HistoryTree implements vscode.TreeDataProvider<CommitNode> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private target?: { root: string; rel: string };
  private items: CommitNode[] = [];
  view?: vscode.TreeView<CommitNode>;

  async setTarget(root: string, rel: string) {
    if (this.target?.root === root && this.target.rel === rel) return;
    this.target = { root, rel };
    const commits = await fileHistory(root, rel);
    this.items = commits.map((c) => ({ root, rel, c }));
    if (this.view) this.view.description = basename(rel);
    this.emitter.fire();
  }

  getChildren(n?: CommitNode) { return n ? [] : this.items; }

  getTreeItem(n: CommitNode): vscode.TreeItem {
    const it = new vscode.TreeItem(n.c.subject);
    it.description = `${n.c.date} · ${n.c.author}`;
    it.tooltip = `${n.c.sha.slice(0, 8)}  ${n.c.author}  ${n.c.date}\n${n.c.subject}\n${n.c.path}`;
    it.iconPath = new vscode.ThemeIcon('git-commit');
    it.command = { command: 'mdReview.openCommit', title: vscode.l10n.t('Open commit'), arguments: [n.root, n.c] };
    return it;
  }
}

export interface OutlineNode { i: number; level: number; text: string; n: number }

/** Sections with changes in the file being reviewed — click to scroll the Review tab there. */
export class OutlineTree implements vscode.TreeDataProvider<OutlineNode> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  items: OutlineNode[] = [];
  current = -2;
  view?: vscode.TreeView<OutlineNode>;

  set(items: OutlineNode[], file?: string) {
    this.items = items;
    if (this.view) {
      this.view.description = file ?? '';
      this.view.message = items.length ? undefined : file ? vscode.l10n.t('This file has no changes.') : vscode.l10n.t('Open a file in the Review tab to see its changed sections.');
    }
    this.emitter.fire();
  }

  setCurrent(i: number) {
    this.current = i;
    const it = this.items.find((x) => x.i === i);
    if (it && this.view?.visible) void this.view.reveal(it, { select: true, focus: false }).then(undefined, () => {});
  }

  getChildren(n?: OutlineNode) { return n ? [] : this.items; }
  getParent() { return undefined; }

  getTreeItem(n: OutlineNode): vscode.TreeItem {
    const minLv = Math.min(...this.items.filter((x) => x.i >= 0).map((x) => x.level), 6);
    const indent = ' '.repeat(Math.max(0, (n.i < 0 ? minLv : n.level) - minLv));
    const it = new vscode.TreeItem(indent + n.text);
    it.id = `sec:${n.i}`;
    it.description = `${n.n}`;
    it.tooltip = `${n.text}\n${vscode.l10n.t('{0} changes', n.n)}`;
    it.iconPath = new vscode.ThemeIcon(n.level <= minLv ? 'symbol-namespace' : 'symbol-field');
    it.command = { command: 'mdReview.scrollToSection', title: vscode.l10n.t('Go to section'), arguments: [n.i] };
    return it;
  }
}
