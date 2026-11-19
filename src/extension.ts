import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { Baseline, Baselines, readText } from './baseline/baseline';
import { Commit, revExists, show } from './git/git';
import { DiffPanel, DiffRequest } from './panel/diffPanel';
import { ReviewState } from './state/reviewState';
import { ChangesTree, FileNode, HistoryTree, OutlineTree } from './views/trees';

const isMd = (p: string) => /\.(md|markdown)$/i.test(p);

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration('mdReview');
  const state = new ReviewState(ctx.workspaceState, ctx.globalState);
  const baselines = new Baselines(ctx.globalStorageUri.fsPath, () => cfg().get<string>('mrBaseBranch') || 'docs/detail_design');
  const baseline = (): Baseline => state.baseline({ kind: cfg().get<Baseline['kind']>('defaultBaseline') || 'head' });

  // ---------- tìm repo ----------
  let gitApi: any;
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    gitApi = (await ext?.activate())?.getAPI(1);
  } catch { /* không có git extension */ }
  const scanned: string[] = [];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const p = f.uri.fsPath;
    if (existsSync(join(p, '.git'))) scanned.push(p);
    else {
      try {
        for (const d of readdirSync(p, { withFileTypes: true })) if (d.isDirectory() && existsSync(join(p, d.name, '.git'))) scanned.push(join(p, d.name));
      } catch { /* bỏ qua */ }
    }
  }
  const roots = (): string[] => {
    const fromApi: string[] = gitApi?.repositories?.map((r: any) => r.rootUri.fsPath) ?? [];
    return [...new Set([...fromApi, ...scanned])].sort();
  };
  const rootOf = (file: string): string | undefined => {
    const r = roots().filter((x) => file.startsWith(x + '/')).sort((a, b) => b.length - a.length)[0];
    if (r) return r;
    try {
      return execFileSync('git', ['-C', dirname(file), 'rev-parse', '--show-toplevel']).toString().trim() || undefined;
    } catch { return undefined; }
  };

  // ---------- thành phần ----------
  const changes = new ChangesTree(roots, baselines, state, baseline);
  const history = new HistoryTree();
  const outline = new OutlineTree();
  const setViewed = (root: string, rel: string, content: string, v: boolean) => {
    state.setViewed(root, rel, content, v);
    if (v) baselines.saveSnapshot(root, rel, content);
    changes.refreshItem({ kind: 'file', root, rel });
  };
  const panel = new DiffPanel(ctx, {
    state,
    neighbours(root, rel) {
      const list = changes.flat();
      const i = list.findIndex((f) => f.root === root && f.rel === rel);
      if (i < 0) return { pos: list.length ? `ngoài danh sách (${list.length} file)` : undefined, next: list[0] && (() => openFile(list[0])) };
      return {
        pos: `${i + 1}/${list.length}`,
        prev: i > 0 ? () => openFile(list[i - 1]) : undefined,
        next: i < list.length - 1 ? () => openFile(list[i + 1]) : undefined,
      };
    },
    pickBaseline: () => void vscode.commands.executeCommand('mdReview.pickBaseline'),
    setViewed,
    onOutline: (items) => outline.set(items, panel.current ? basename(panel.current.rel) : undefined),
    onSection: (i) => outline.setCurrent(i),
  });

  const workingRequest = (root: string, rel: string): DiffRequest => ({
    root, rel, working: true,
    title: basename(rel),
    sub: baselines.label(baseline()),
    load: async () => ({ old: await baselines.oldContent(root, rel, baseline()), new: readText(join(root, rel)) }),
  });

  async function openFile(n: FileNode) {
    await panel.show(workingRequest(n.root, n.rel));
    void history.setTarget(n.root, n.rel);
    try { await changes.view?.reveal(n, { select: true, focus: false }); } catch { /* chưa có trong cây */ }
  }

  let lastMd: vscode.Uri | undefined;
  const activeMd = (): vscode.Uri | undefined => {
    const inp = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (inp instanceof vscode.TabInputText || inp instanceof vscode.TabInputCustom) return isMd(inp.uri.fsPath) ? inp.uri : lastMd;
    if (inp instanceof vscode.TabInputTextDiff) return isMd(inp.modified.fsPath) ? inp.modified : lastMd;
    return lastMd;
  };
  const trackActive = () => {
    const u = (() => {
      const inp = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (inp instanceof vscode.TabInputText || inp instanceof vscode.TabInputCustom) return inp.uri;
      if (inp instanceof vscode.TabInputTextDiff) return inp.modified;
      return undefined;
    })();
    if (u && u.scheme === 'file' && isMd(u.fsPath)) {
      lastMd = u;
      const r = rootOf(u.fsPath);
      if (r) void history.setTarget(r, u.fsPath.slice(r.length + 1));
    }
  };

  // ---------- view ----------
  changes.view = vscode.window.createTreeView('mdReview.changes', { treeDataProvider: changes, showCollapseAll: true }) as any;
  history.view = vscode.window.createTreeView('mdReview.history', { treeDataProvider: history }) as any;
  outline.view = vscode.window.createTreeView('mdReview.outline', { treeDataProvider: outline });
  outline.set([]);
  const updateTitle = () => {
    const short: Record<string, string> = { head: 'HEAD', index: 'chưa stage', mergeBase: 'như MR', reviewed: 'từ lần review trước', claude: 'lượt Claude' };
    const b = baseline();
    changes.view!.title = `File thay đổi · ${b.kind === 'rev' ? b.rev : short[b.kind]}`;
  };
  updateTitle();
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

  // ---------- lệnh ----------
  const reg = (id: string, fn: (...a: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('mdReview.open', async (arg?: any) => {
    let uri: vscode.Uri | undefined = arg instanceof vscode.Uri ? arg : arg?.resourceUri ?? undefined;
    uri ??= activeMd();
    if (!uri) {
      const first = changes.flat()[0];
      if (first) return openFile(first);
      return vscode.window.showInformationMessage('MD Review: hãy mở một file .md trước.');
    }
    const root = rootOf(uri.fsPath);
    if (!root) return vscode.window.showWarningMessage('MD Review: file này không nằm trong git repo nào.');
    await openFile({ kind: 'file', root, rel: uri.fsPath.slice(root.length + 1) });
  });
  reg('mdReview.openFile', (n: FileNode) => openFile(n));
  reg('mdReview.scrollToSection', (i: number) => panel.scrollTo(i));
  reg('mdReview.openCommit', async (root: string, c: Commit) => {
    const sha = c.sha.slice(0, 8);
    await panel.show({
      root, rel: c.path, working: false, blameRev: c.sha,
      title: `${basename(c.path)} @ ${sha}`,
      sub: `Commit ${sha}: ${c.subject} — ${c.author}, ${c.date}`,
      load: async () => ({ old: (await show(root, `${c.sha}^:${c.path}`)) ?? '', new: (await show(root, `${c.sha}:${c.path}`)) ?? '' }),
    });
  });
  reg('mdReview.refresh', async () => { await changes.reload(); await panel.refresh(); });
  reg('mdReview.nextFile', () => {
    const c = panel.current;
    const nb = c ? (panel as any).host.neighbours(c.root, c.rel) : { next: () => changes.flat()[0] && openFile(changes.flat()[0]) };
    nb.next?.();
  });
  reg('mdReview.prevFile', () => {
    const c = panel.current;
    if (c) (panel as any).host.neighbours(c.root, c.rel).prev?.();
  });
  reg('mdReview.pickBaseline', async () => {
    const cur = baseline();
    type It = vscode.QuickPickItem & { b?: Baseline; custom?: boolean };
    const mk = (b: Baseline, detail: string): It => ({
      label: (cur.kind === b.kind && (b.kind !== 'rev' || cur.rev === b.rev) ? '$(check) ' : '$(blank) ') + baselines.label(b),
      detail, b,
    });
    const claude = baselines.latestClaudeTurn();
    const items: It[] = [
      mk({ kind: 'head' }, 'Mọi thay đổi chưa commit (gồm cả phần đã git add)'),
      mk({ kind: 'reviewed' }, 'Chỉ phần mới đổi kể từ lúc bạn tick "Đã xem" file đó (không cần commit)'),
      mk({ kind: 'claude' }, claude ? `Chỉ phần Claude sửa trong lượt gần nhất — ${new Date(claude.time).toLocaleString('vi-VN')}` : 'Chưa có dữ liệu — cần cài hook Claude (lệnh "MD Review: Cài hook Claude Code")'),
      mk({ kind: 'mergeBase' }, 'Giống những gì reviewer thấy trên MR'),
      mk({ kind: 'index' }, 'Thay đổi chưa git add'),
      { label: '$(git-commit) Commit / branch khác…', custom: true },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'MD Review: so sánh với mốc nào?' });
    if (!pick) return;
    let b = pick.b;
    if (pick.custom) {
      const rev = await vscode.window.showInputBox({ prompt: 'Nhập commit, tag hoặc branch (vd: HEAD~3, main, origin/docs/detail_design)', value: cur.rev });
      if (!rev) return;
      const ok = await Promise.all(roots().map((r) => revExists(r, rev)));
      if (!ok.some(Boolean)) return vscode.window.showWarningMessage(`MD Review: không tìm thấy "${rev}".`);
      b = { kind: 'rev', rev };
    }
    state.setBaseline(b!);
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
  const setTreeMode = (v: boolean) => {
    changes.setTreeMode(v);
    void ctx.globalState.update('treeMode', v);
    void vscode.commands.executeCommand('setContext', 'mdReview.treeMode', v);
  };
  reg('mdReview.viewAsTree', () => setTreeMode(true));
  reg('mdReview.viewAsList', () => setTreeMode(false));
  setTreeMode(ctx.globalState.get<boolean>('treeMode') ?? true);

  // ---------- tự cập nhật ----------
  let tReload: NodeJS.Timeout | undefined, tPanel: NodeJS.Timeout | undefined;
  const onMdChange = (u: vscode.Uri) => {
    clearTimeout(tReload);
    tReload = setTimeout(() => void changes.reload(), 800);
    const c = panel.current;
    if (c?.working && join(c.root, c.rel) === u.fsPath) {
      clearTimeout(tPanel);
      tPanel = setTimeout(() => void panel.refresh(), 250);
    }
  };
  const w = vscode.workspace.createFileSystemWatcher('**/*.{md,markdown}');
  ctx.subscriptions.push(w, w.onDidChange(onMdChange), w.onDidCreate(onMdChange), w.onDidDelete(onMdChange),
    vscode.workspace.onDidSaveTextDocument((d) => isMd(d.uri.fsPath) && onMdChange(d.uri)),
    vscode.window.tabGroups.onDidChangeTabs(trackActive),
    vscode.window.onDidChangeActiveTextEditor(trackActive),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('mdReview') && void changes.reload()));
  const hookRepo = (r: any) => ctx.subscriptions.push(r.state.onDidChange(() => {
    clearTimeout(tReload);
    tReload = setTimeout(() => void changes.reload(), 800);
  }));
  if (gitApi) {
    gitApi.repositories.forEach(hookRepo);
    ctx.subscriptions.push(gitApi.onDidOpenRepository((r: any) => { hookRepo(r); void changes.reload(); }));
  }

  trackActive();
  void changes.reload();
}

/** Thêm hook vào ~/.claude/settings.json (cấp user — chỉ máy này). */
async function installClaudeHook(ctx: vscode.ExtensionContext) {
  const { homedir } = await import('node:os');
  const { readFileSync, writeFileSync, copyFileSync } = await import('node:fs');
  const { mkdirSync } = await import('node:fs');
  const file = join(homedir(), '.claude', 'settings.json');
  // chép script ra chỗ cố định để đường dẫn không đổi khi extension lên phiên bản mới
  const dir = join(homedir(), '.local', 'share', 'md-review');
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'claude-snapshot.mjs');
  copyFileSync(join(ctx.extensionPath, 'hooks', 'claude-snapshot.mjs'), script);
  const cmd = `node "${script}"`;
  let json: any = {};
  if (existsSync(file)) {
    try { json = JSON.parse(readFileSync(file, 'utf8')); } catch {
      return vscode.window.showErrorMessage(`MD Review: không đọc được ${file} (JSON lỗi) — không sửa gì.`);
    }
    copyFileSync(file, file + '.md-review.bak');
  }
  json.hooks ??= {};
  const add = (event: string, matcher: string | undefined) => {
    const list: any[] = (json.hooks[event] ??= []);
    // bỏ bản cũ của hook này (nếu cài lại từ đường dẫn khác)
    for (const g of list) g.hooks = (g.hooks ?? []).filter((h: any) => !String(h.command ?? '').includes('claude-snapshot.mjs'));
    json.hooks[event] = list.filter((g) => (g.hooks ?? []).length);
    json.hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd, timeout: 10 }] });
  };
  add('UserPromptSubmit', undefined);
  add('PreToolUse', 'Edit|Write|MultiEdit');
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  vscode.window.showInformationMessage('MD Review: đã cài hook vào ~/.claude/settings.json. Các phiên Claude Code mở sau sẽ ghi lại bản trước khi sửa file .md.');
}

export function deactivate() {}
