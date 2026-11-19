import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { changedVsIndex, changedVsRev, mergeBase, show } from '../git/git';

export type BaselineKind = 'head' | 'index' | 'mergeBase' | 'rev' | 'reviewed' | 'claude';
export interface Baseline { kind: BaselineKind; rev?: string }

export const CLAUDE_DIR = join(homedir(), '.cache', 'md-review', 'claude');

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
  constructor(private storage: string, private mrBranch: () => string) {}

  // ---------- snapshot "đã review" ----------
  private snapPath(root: string, rel: string) {
    return join(this.storage, 'snapshots', hash(root), rel);
  }
  saveSnapshot(root: string, rel: string, content: string) {
    const p = this.snapPath(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  private snapshot(root: string, rel: string): string | undefined {
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

  // ---------- lượt Claude gần nhất ----------
  latestClaudeTurn(): { dir: string; index: Record<string, { snap: string | null }>; time: number } | undefined {
    const turns = join(CLAUDE_DIR, 'turns');
    if (!existsSync(turns)) return undefined;
    let best: { dir: string; time: number } | undefined;
    for (const name of readdirSync(turns)) {
      const idx = join(turns, name, 'index.json');
      if (!existsSync(idx)) continue;
      const t = statSync(idx).mtimeMs;
      if (!best || t > best.time) best = { dir: join(turns, name), time: t };
    }
    if (!best) return undefined;
    return { ...best, index: JSON.parse(readText(join(best.dir, 'index.json')) || '{}') };
  }

  // ---------- API chung ----------
  label(b: Baseline): string {
    switch (b.kind) {
      case 'head': return 'Commit gần nhất (HEAD)';
      case 'index': return 'Phần chưa stage';
      case 'mergeBase': return `Như trên MR (so với ${this.mrBranch()})`;
      case 'rev': return `Commit/branch ${b.rev}`;
      case 'reviewed': return 'Từ lần review trước';
      case 'claude': return 'Lượt Claude sửa gần nhất';
    }
  }

  private async revFor(root: string, b: Baseline): Promise<string | undefined> {
    if (b.kind === 'head' || b.kind === 'reviewed') return 'HEAD';
    if (b.kind === 'rev') return b.rev;
    if (b.kind === 'mergeBase') return mergeBase(root, this.mrBranch());
    return undefined;
  }

  async listFiles(root: string, b: Baseline): Promise<string[]> {
    if (b.kind === 'index') return changedVsIndex(root);
    if (b.kind === 'claude') {
      const t = this.latestClaudeTurn();
      if (!t) return [];
      return Object.keys(t.index)
        .filter((abs) => abs.startsWith(root + '/'))
        .map((abs) => abs.slice(root.length + 1))
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
    const e = t?.index[join(root, rel)];
    return e?.snap ? readText(join(t!.dir, e.snap)) : '';
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
