import { execFile } from 'node:child_process';

const MAX = 1 << 28;

export function git(root: string, args: string[], allowFail = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { maxBuffer: MAX, encoding: 'buffer' }, (err, out) => {
      if (err && !allowFail) return reject(err);
      resolve(err ? '' : out.toString('utf8'));
    });
  });
}

export async function show(root: string, spec: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, 'show', spec], { maxBuffer: MAX, encoding: 'buffer' }, (err, out) =>
      resolve(err ? undefined : out.toString('utf8')));
  });
}

const MD = ['--', '*.md', '*.markdown'];

/** File .md khác nhau giữa rev và working tree (kể cả file mới chưa track). */
export async function changedVsRev(root: string, rev: string): Promise<string[]> {
  const [d, u] = await Promise.all([
    git(root, ['diff', '-z', '--name-only', rev, ...MD], true),
    git(root, ['ls-files', '-z', '--others', '--exclude-standard', ...MD], true),
  ]);
  return [...new Set([...d.split('\0'), ...u.split('\0')].filter(Boolean))].sort();
}

/** File .md có thay đổi chưa stage (working tree vs index). */
export async function changedVsIndex(root: string): Promise<string[]> {
  const [d, u] = await Promise.all([
    git(root, ['diff', '-z', '--name-only', ...MD], true),
    git(root, ['ls-files', '-z', '--others', '--exclude-standard', ...MD], true),
  ]);
  return [...new Set([...d.split('\0'), ...u.split('\0')].filter(Boolean))].sort();
}

export async function mergeBase(root: string, branch: string): Promise<string | undefined> {
  for (const ref of [`origin/${branch}`, branch]) {
    const out = (await git(root, ['merge-base', 'HEAD', ref], true)).trim();
    if (out) return out;
  }
  return undefined;
}

export async function revExists(root: string, rev: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], true)).trim() !== '';
}

export interface Commit { sha: string; author: string; date: string; subject: string; path: string }

export async function fileHistory(root: string, rel: string, limit = 200): Promise<Commit[]> {
  const out = await git(root, ['log', '--follow', `-n${limit}`, '--name-only', '--date=short',
    '--format=%x1e%H%x1f%an%x1f%ad%x1f%s', '--', rel], true);
  const res: Commit[] = [];
  for (const chunk of out.split('\x1e')) {
    if (!chunk.trim()) continue;
    const [head, ...rest] = chunk.split('\n');
    const [sha, author, date, subject] = head.split('\x1f');
    const path = rest.map((s) => s.trim()).filter(Boolean).pop() ?? rel;
    res.push({ sha, author, date, subject, path });
  }
  return res;
}

export interface BlameInfo { sha: string; author: string; time: number; summary: string; lines: number; commits: number }

/** Blame một dải dòng (1-based, gồm cả 2 đầu) -> commit mới nhất trong dải. */
export async function blameRange(root: string, rel: string, start: number, end: number, rev?: string): Promise<BlameInfo | undefined> {
  const out = await git(root, ['blame', '--porcelain', '-L', `${start},${end}`, ...(rev ? [rev] : []), '--', rel], true);
  if (!out) return undefined;
  const info = new Map<string, { author: string; time: number; summary: string }>();
  const count = new Map<string, number>();
  let cur = '';
  for (const line of out.split('\n')) {
    const h = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
    if (h) {
      cur = h[1];
      count.set(cur, (count.get(cur) ?? 0) + 1);
      if (!info.has(cur)) info.set(cur, { author: '', time: 0, summary: '' });
      continue;
    }
    const i = info.get(cur);
    if (!i) continue;
    if (line.startsWith('author ')) i.author = line.slice(7);
    else if (line.startsWith('author-time ')) i.time = Number(line.slice(12));
    else if (line.startsWith('summary ')) i.summary = line.slice(8);
  }
  let best: BlameInfo | undefined;
  for (const [sha, i] of info) {
    if (!best || i.time > best.time) best = { sha, ...i, lines: count.get(sha) ?? 0, commits: info.size };
  }
  return best;
}
