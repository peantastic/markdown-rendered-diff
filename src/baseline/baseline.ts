import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { changedVsIndex, changedVsRev, defaultBranch, mergeBase, show } from '../git/git';
import { format } from '../i18n/webviewStrings';

export type BaselineKind = 'head' | 'index' | 'mergeBase' | 'rev' | 'reviewed' | 'claude';
export interface Baseline { kind: BaselineKind; rev?: string }

/** Per-user cache folder where the Claude Code hook stores pre-edit snapshots (passed to the hook as an argument). */
export function claudeDataDir(): string {
  const app = 'markdown-rendered-diff';
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), app, 'claude');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', app, 'claude');
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), app, 'claude');
}

/** Case-insensitive on Windows, separator-agnostic path prefix check; returns the repo-relative path with '/' or undefined. */
export function relInside(root: string, abs: string): string | undefined {
  const norm = (p: string) => {
    const x = p.replace(/[\\/]+/g, '/').replace(/\/$/, '');
    return process.platform === 'win32' ? x.toLowerCase() : x;
  };
  const r = norm(root) + '/', a = norm(abs);
  if (!a.startsWith(r)) return undefined;
  return abs.replace(/[\\/]+/g, '/').slice(r.length);
}

/** Repository-relative path without absolute/parent components. */
export function safeRel(rel: string): boolean {
  if (!rel || rel.includes('\0') || /^([a-zA-Z]:|[\\/])/.test(rel)) return false;
  return !rel.split(/[\\/]/).some((part) => part === '..');
}

const KINDS = ['head', 'index', 'mergeBase', 'rev', 'reviewed', 'claude'];
/** Baselines restored from storage are data: validate before use. */
export function validBaseline(b: unknown): b is Baseline {
  const x = b as Baseline | undefined;
  return !!x && KINDS.includes(x.kind) && (x.kind !== 'rev' || (typeof x.rev === 'string' && x.rev.length > 0 && x.rev.length <= 200 && !x.rev.startsWith('-')));
}

export type Translate = (message: string, ...args: (string | number)[]) => string;

export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export function readText(p: string): string {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

export class Baselines {
  constructor(
    private storage: string,
    /** Configured PR/MR target branch ('' = detect per repository). */
    private mrBranch: () => string,
    private t: Translate = (m, ...a) => format(m, ...a),
  ) {}

  private branchCache = new Map<string, string | undefined>();
  private async targetBranch(root: string): Promise<string | undefined> {
    const configured = this.mrBranch();
    if (configured) return configured;
    if (!this.branchCache.has(root)) this.branchCache.set(root, await defaultBranch(root));
    return this.branchCache.get(root);
  }
  clearCache() { this.branchCache.clear(); }

  // ---------- "reviewed" snapshots ----------
  private snapPath(root: string, rel: string) {
    const base = join(this.storage, 'snapshots', hash(root));
    const p = join(base, rel);
    // rel always comes from git or our own tree; refuse anything that would escape the snapshot folder
    if (!safeRel(rel) || relative(base, p).startsWith('..')) throw new Error(`unsafe path: ${rel}`);
    return p;
  }
  saveSnapshot(root: string, rel: string, content: string) {
    if (!safeRel(rel)) return;
    const p = this.snapPath(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  private snapshot(root: string, rel: string): string | undefined {
    if (!safeRel(rel)) return undefined;
    const p = this.snapPath(root, rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  }
  private snapshotFiles(root: string): string[] {
    const base = join(this.storage, 'snapshots', hash(root));
    const out: string[] = [];
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(relative(base, p).split(sep).join('/'));
      }
    };
    walk(base);
    return out;
  }

  // ---------- latest Claude Code turn ----------
  latestClaudeTurn(): { dir: string; index: Record<string, { snap: string | null }>; time: number } | undefined {
    const turns = join(claudeDataDir(), 'turns');
    if (!existsSync(turns)) return undefined;
    let best: { dir: string; time: number } | undefined;
    for (const name of readdirSync(turns)) {
      const idx = join(turns, name, 'index.json');
      if (!existsSync(idx)) continue;
      const t = statSync(idx).mtimeMs;
      if (!best || t > best.time) best = { dir: join(turns, name), time: t };
    }
    if (!best) return undefined;
    try {
      return { ...best, index: JSON.parse(readText(join(best.dir, 'index.json')) || '{}') };
    } catch { return undefined; }
  }

  // ---------- public API ----------
  label(b: Baseline): string {
    switch (b.kind) {
      case 'head': return this.t('Last commit (HEAD)');
      case 'index': return this.t('Unstaged changes');
      case 'mergeBase': return this.mrBranch()
        ? this.t('As in the PR/MR (vs {0})', this.mrBranch())
        : this.t('As in the PR/MR (vs default branch)');
      case 'rev': return this.t('Commit/branch {0}', b.rev ?? '');
      case 'reviewed': return this.t('Since your last review');
      case 'claude': return this.t('Latest Claude Code turn');
    }
  }

  private async revFor(root: string, b: Baseline): Promise<string | undefined> {
    if (b.kind === 'head' || b.kind === 'reviewed') return 'HEAD';
    if (b.kind === 'rev') return b.rev;
    if (b.kind === 'mergeBase') {
      const branch = await this.targetBranch(root);
      return branch ? mergeBase(root, branch) : undefined;
    }
    return undefined;
  }

  async listFiles(root: string, b: Baseline): Promise<string[]> {
    if (b.kind === 'index') return changedVsIndex(root);
    if (b.kind === 'claude') {
      const t = this.latestClaudeTurn();
      if (!t) return [];
      return Object.keys(t.index)
        .map((abs) => relInside(root, abs))
        .filter((rel): rel is string => rel !== undefined)
        .filter((rel) => this.claudeOld(root, rel, t) !== readText(join(root, rel)))
        .sort();
    }
    const rev = await this.revFor(root, b);
    if (!rev) return [];
    const files = await changedVsRev(root, rev);
    if (b.kind !== 'reviewed') return files;
    const all = [...new Set([...files, ...this.snapshotFiles(root)])].sort();
    const res: string[] = [];
    for (const rel of all) if ((await this.oldContent(root, rel, b)) !== readText(join(root, rel))) res.push(rel);
    return res;
  }

  private claudeOld(root: string, rel: string, t = this.latestClaudeTurn()): string {
    if (!t) return '';
    const key = Object.keys(t.index).find((abs) => relInside(root, abs) === rel);
    const e = key ? t.index[key] : undefined;
    // the hook only ever writes files/<n>.md; ignore anything else found in index.json
    return typeof e?.snap === 'string' && /^files\/\d+\.md$/.test(e.snap) ? readText(join(t.dir, e.snap)) : '';
  }

  async oldContent(root: string, rel: string, b: Baseline): Promise<string> {
    if (b.kind === 'index') return (await show(root, `:${rel}`)) ?? '';
    if (b.kind === 'claude') return this.claudeOld(root, rel);
    if (b.kind === 'reviewed') {
      const s = this.snapshot(root, rel);
      if (s !== undefined) return s;
    }
    const rev = await this.revFor(root, b);
    return rev ? (await show(root, `${rev}:${rel}`)) ?? '' : '';
  }
}
