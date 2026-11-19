import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { basename } from 'node:path/posix';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { Baseline, Baselines, readText, relInside } from './baseline/baseline';
import { Commit, revExists, show } from './git/git';
import { DiffPanel, DiffRequest } from './panel/diffPanel';
import { ReviewState } from './state/reviewState';
import { ChangesTree, FileNode, HistoryTree, OutlineTree } from './views/trees';
import { claudeHookInstalled, installClaudeHook, uninstallClaudeHook } from './claudeHook';

const isMd = (p: string) => /\.(md|markdown)$/i.test(p);
const LARGE_FILE = 2 * 1024 * 1024;

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration('mdReview');
  const trusted = () => vscode.workspace.isTrusted;
  const renderHtml = () => trusted() && cfg().get<boolean>('renderHtml', true);
  const state = new ReviewState(ctx.workspaceState, ctx.globalState);
  const baselines = new Baselines(ctx.globalStorageUri.fsPath, () => (cfg().get<string>('mrBaseBranch') ?? '').trim(),
    (m, ...a) => vscode.l10n.t(m, ...a));
  const baseline = (): Baseline => state.baseline({ kind: cfg().get<Baseline['kind']>('defaultBaseline') || 'head' });

  // ---------- repositories ----------
  let gitApi: any;
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    gitApi = (await ext?.activate())?.getAPI(1);
  } catch { /* git extension disabled */ }
  // also pick up repositories one level below the workspace folders (the git extension may not open them)
  let scanned: string[] = [];
  const scan = () => {
    scanned = [];
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (f.uri.scheme !== 'file') continue;
      const p = f.uri.fsPath;
      if (existsSync(join(p, '.git'))) scanned.push(p);
      else {
        try {
          for (const d of readdirSync(p, { withFileTypes: true })) if (d.isDirectory() && existsSync(join(p, d.name, '.git'))) scanned.push(join(p, d.name));
        } catch { /* ignore */ }
      }
    }
  };
  scan();
  // git runs hooks/config from the repository, so nothing touches git until the workspace is trusted
  const roots = (): string[] => {
    if (!trusted()) return [];
    const fromApi: string[] = gitApi?.repositories?.map((r: any) => r.rootUri.fsPath) ?? [];
    return [...new Set([...fromApi, ...scanned])].sort();
  };
  const rootOf = (file: string): string | undefined => {
    if (!trusted()) return undefined;
    const r = roots().filter((x) => relInside(x, file) !== undefined).sort((a, b) => b.length - a.length)[0];
    if (r) return r;
    try {
      const top = execFileSync('git', ['-C', dirname(file), 'rev-parse', '--show-toplevel']).toString().trim();
      return top ? resolve(top) : undefined;
    } catch { return undefined; }
  };
  const updateContext = () => {
    void vscode.commands.executeCommand('setContext', 'mdReview.hasRepo', roots().length > 0);
    void vscode.commands.executeCommand('setContext', 'mdReview.trusted', trusted());
  };

  // ---------- components ----------
  const changes = new ChangesTree(roots, baselines, state, baseline, renderHtml);
  const history = new HistoryTree();
  const outline = new OutlineTree();
  const setViewed = (root: string, rel: string, content: string, v: boolean) => {
    state.setViewed(root, rel, content, v);
    if (v) baselines.saveSnapshot(root, rel, content);
    changes.refreshItem({ kind: 'file', root, rel });
  };
  const neighbours = (root: string, rel: string) => {
    const list = changes.flat();
    const i = list.findIndex((f) => f.root === root && f.rel === rel);
    if (i < 0) return { pos: list.length ? vscode.l10n.t('not in list ({0} files)', list.length) : undefined, next: list[0] && (() => openFile(list[0])) };
    return {
      pos: `${i + 1}/${list.length}`,
      prev: i > 0 ? () => openFile(list[i - 1]) : undefined,
      next: i < list.length - 1 ? () => openFile(list[i + 1]) : undefined,
    };
  };
  const panel = new DiffPanel(ctx, {
    state,
    neighbours,
    pickBaseline: () => void vscode.commands.executeCommand('mdReview.pickBaseline'),
    setViewed,
    onOutline: (items) => outline.set(items, panel.current ? basename(panel.current.rel) : undefined),
    onSection: (i) => outline.setCurrent(i),
    renderHtml,
    allowRemoteImages: () => cfg().get<boolean>('allowRemoteImages', false),
  });

  const confirmedLarge = new Set<string>();
  const workingRequest = (root: string, rel: string): DiffRequest => ({
    root, rel, working: true,
    title: basename(rel),
    sub: baselines.label(baseline()),
    load: async () => ({ old: await baselines.oldContent(root, rel, baseline()), new: readText(join(root, rel)) }),
  });

  async function openFile(n: FileNode) {
    const abs = join(n.root, n.rel);
    try {
      const size = existsSync(abs) ? statSync(abs).size : 0;
      if (size > LARGE_FILE && !confirmedLarge.has(abs)) {
        const go = vscode.l10n.t('Open anyway');
        const ok = await vscode.window.showWarningMessage(
          vscode.l10n.t('{0} is large ({1} MB). Rendering the diff may take a while.', basename(n.rel), (size / 1048576).toFixed(1)),
          { modal: true }, go);
        if (ok !== go) return;
        confirmedLarge.add(abs);
      }
    } catch { /* ignore */ }
    await panel.show(workingRequest(n.root, n.rel));
    void history.setTarget(n.root, n.rel);
    try { await changes.view?.reveal(n, { select: true, focus: false }); } catch { /* not in tree */ }
  }

  let lastMd: vscode.Uri | undefined;
  const tabUri = (): vscode.Uri | undefined => {
    const inp = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (inp instanceof vscode.TabInputText || inp instanceof vscode.TabInputCustom) return inp.uri;
    if (inp instanceof vscode.TabInputTextDiff) return inp.modified;
    return undefined;
  };
  const activeMd = (): vscode.Uri | undefined => {
    const u = tabUri();
    return u && isMd(u.fsPath) ? u : lastMd;
  };
  const trackActive = () => {
    const u = tabUri();
    if (u && u.scheme === 'file' && isMd(u.fsPath)) {
      lastMd = u;
      const r = rootOf(u.fsPath);
      const rel = r && relInside(r, u.fsPath);
      if (r && rel) void history.setTarget(r, rel);
    }
  };

  // ---------- views ----------
  changes.view = vscode.window.createTreeView('mdReview.changes', { treeDataProvider: changes, showCollapseAll: true }) as any;
  history.view = vscode.window.createTreeView('mdReview.history', { treeDataProvider: history }) as any;
  outline.view = vscode.window.createTreeView('mdReview.outline', { treeDataProvider: outline });
  outline.set([]);
  const updateTitle = () => {
    const b = baseline();
    const short: Record<string, string> = {
      head: 'HEAD',
      index: vscode.l10n.t('unstaged'),
      mergeBase: vscode.l10n.t('PR/MR'),
      reviewed: vscode.l10n.t('since review'),
      claude: vscode.l10n.t('Claude turn'),
    };
    changes.view!.title = vscode.l10n.t('Changed Files · {0}', b.kind === 'rev' ? b.rev ?? '' : short[b.kind]);
  };
  updateTitle();
  updateContext();
  ctx.subscriptions.push(
    changes.view!,
    history.view!,
    vscode.window.registerFileDecorationProvider(changes.decorations),
    outline.view,
    changes.view!.onDidChangeCheckboxState((e) => {
      for (const [n, s] of e.items) {
        if ((n as any).kind !== 'file') continue;
        const f = n as FileNode;
        setViewed(f.root, f.rel, readText(join(f.root, f.rel)), s === vscode.TreeItemCheckboxState.Checked);
        if (panel.current?.root === f.root && panel.current.rel === f.rel) void panel.refresh();
      }
    }),
  );

  // ---------- commands ----------
  const reg = (id: string, fn: (...a: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('mdReview.open', async (arg?: any) => {
    let uri: vscode.Uri | undefined = arg instanceof vscode.Uri ? arg : arg?.resourceUri ?? undefined;
    uri ??= activeMd();
    if (!trusted()) {
      return vscode.window.showWarningMessage(vscode.l10n.t('Markdown Rendered Diff needs a trusted workspace to read git history.'));
    }
    if (!uri) {
      const first = changes.flat()[0];
      if (first) return openFile(first);
      return vscode.window.showInformationMessage(vscode.l10n.t('Open a Markdown file first.'));
    }
    const root = rootOf(uri.fsPath);
    const rel = root && relInside(root, uri.fsPath);
    if (!root || !rel) return vscode.window.showWarningMessage(vscode.l10n.t('This file is not inside a git repository.'));
    await openFile({ kind: 'file', root, rel });
  });
  reg('mdReview.openFile', (n: FileNode) => openFile(n));
  reg('mdReview.scrollToSection', (i: number) => panel.scrollTo(i));
  reg('mdReview.openCommit', async (root: string, c: Commit) => {
    const sha = c.sha.slice(0, 8);
    await panel.show({
      root, rel: c.path, working: false, blameRev: c.sha,
      title: `${basename(c.path)} @ ${sha}`,
      sub: vscode.l10n.t('Commit {0}: {1} — {2}, {3}', sha, c.subject, c.author, c.date),
      load: async () => ({ old: (await show(root, `${c.sha}^:${c.path}`)) ?? '', new: (await show(root, `${c.sha}:${c.path}`)) ?? '' }),
    });
  });
  reg('mdReview.refresh', async () => { scan(); baselines.clearCache(); updateContext(); await changes.reload(); await panel.refresh(); });
  reg('mdReview.nextFile', () => {
    const c = panel.current;
    if (c) return neighbours(c.root, c.rel).next?.();
    const first = changes.flat()[0];
    if (first) return openFile(first);
  });
  reg('mdReview.prevFile', () => {
    const c = panel.current;
    if (c) neighbours(c.root, c.rel).prev?.();
  });
  reg('mdReview.pickBaseline', async () => {
    const cur = baseline();
    type It = vscode.QuickPickItem & { b?: Baseline; custom?: boolean; enableClaude?: boolean };
    const mk = (b: Baseline, detail: string): It => ({
      label: (cur.kind === b.kind && (b.kind !== 'rev' || cur.rev === b.rev) ? '$(check) ' : '$(blank) ') + baselines.label(b),
      detail, b,
    });
    const claude = baselines.latestClaudeTurn();
    const hookOn = claudeHookInstalled();
    const items: It[] = [
      mk({ kind: 'head' }, vscode.l10n.t('All uncommitted changes (staged and unstaged)')),
      mk({ kind: 'reviewed' }, vscode.l10n.t('Only what changed since you ticked "viewed" on each file (no commit needed)')),
      mk({ kind: 'mergeBase' }, vscode.l10n.t('What reviewers see in the pull/merge request')),
      mk({ kind: 'index' }, vscode.l10n.t('Changes not yet staged (git add)')),
      hookOn || claude
        ? mk({ kind: 'claude' }, claude
          ? vscode.l10n.t('Only what Claude Code changed in its latest turn — {0}', new Date(claude.time).toLocaleString(vscode.env.language))
          : vscode.l10n.t('No Claude Code turn recorded yet'))
        : { label: '$(blank) ' + baselines.label({ kind: 'claude' }), detail: vscode.l10n.t('Off — select to enable Claude Code turn tracking'), enableClaude: true },
      { label: '$(git-commit) ' + vscode.l10n.t('Other commit / branch…'), custom: true },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: vscode.l10n.t('Compare with which baseline?') });
    if (!pick) return;
    if (pick.enableClaude && !(await installClaudeHook(ctx))) return;
    let b: Baseline | undefined = pick.enableClaude ? { kind: 'claude' } : pick.b;
    if (pick.custom) {
      const rev = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Commit, tag or branch (e.g. HEAD~3, main, origin/main)'), value: cur.rev });
      if (!rev) return;
      const ok = await Promise.all(roots().map((r) => revExists(r, rev)));
      if (!ok.some(Boolean)) return vscode.window.showWarningMessage(vscode.l10n.t('"{0}" was not found.', rev));
      b = { kind: 'rev', rev };
    }
    if (!b) return;
    state.setBaseline(b);
    updateTitle();
    await changes.reload();
    const c = panel.current;
    if (c?.working) await panel.show(workingRequest(c.root, c.rel), true);
  });
  reg('mdReview.toggleViewed', () => {
    const c = panel.current;
    if (!c?.working) return;
    const content = readText(join(c.root, c.rel));
    setViewed(c.root, c.rel, content, !state.isViewed(c.root, c.rel, content));
    void panel.refresh();
  });
  reg('mdReview.installClaudeHook', () => installClaudeHook(ctx));
  reg('mdReview.uninstallClaudeHook', () => uninstallClaudeHook());
  const setTreeMode = (v: boolean) => {
    changes.setTreeMode(v);
    void ctx.globalState.update('treeMode', v);
    void vscode.commands.executeCommand('setContext', 'mdReview.treeMode', v);
  };
  reg('mdReview.viewAsTree', () => setTreeMode(true));
  reg('mdReview.viewAsList', () => setTreeMode(false));
  setTreeMode(ctx.globalState.get<boolean>('treeMode') ?? true);

  // ---------- live updates ----------
  let tReload: NodeJS.Timeout | undefined, tPanel: NodeJS.Timeout | undefined;
  const reloadSoon = () => {
    clearTimeout(tReload);
    tReload = setTimeout(() => { updateContext(); void changes.reload(); }, 800);
  };
  const onMdChange = (u: vscode.Uri) => {
    reloadSoon();
    const c = panel.current;
    if (c?.working && relInside(c.root, u.fsPath) === c.rel) {
      clearTimeout(tPanel);
      tPanel = setTimeout(() => void panel.refresh(), 250);
    }
  };
  const w = vscode.workspace.createFileSystemWatcher('**/*.{md,markdown}');
  ctx.subscriptions.push(w, w.onDidChange(onMdChange), w.onDidCreate(onMdChange), w.onDidDelete(onMdChange),
    vscode.workspace.onDidSaveTextDocument((d) => isMd(d.uri.fsPath) && onMdChange(d.uri)),
    vscode.window.tabGroups.onDidChangeTabs(trackActive),
    vscode.window.onDidChangeActiveTextEditor(trackActive),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { scan(); reloadSoon(); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { scan(); updateContext(); void changes.reload(); void panel.refresh(); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('mdReview')) return;
      baselines.clearCache();
      updateTitle();
      void changes.reload();
      void panel.refresh();
    }));
  const hookRepo = (r: any) => ctx.subscriptions.push(r.state.onDidChange(reloadSoon));
  if (gitApi) {
    gitApi.repositories.forEach(hookRepo);
    ctx.subscriptions.push(gitApi.onDidOpenRepository((r: any) => { hookRepo(r); reloadSoon(); }));
  }

  trackActive();
  void changes.reload();
}

export function deactivate() {}
