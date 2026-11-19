import { execFile } from 'node:child_process';

const MAX = 1 << 28;

/** git executable; set to the path used by VS Code's Git extension when available (avoids PATH lookups). */
let gitPath = 'git';
export function setGitPath(p: string | undefined) { if (p) gitPath = p; }
export function gitExecutable() { return gitPath; }

/**
 * Options applied to every git call. A repository's own config can make git run programs
 * (core.fsmonitor, diff drivers, textconv, pagers); none of that is needed to read files and names.
 */
export const SAFE_CONFIG = [
  '-c', 'core.quotepath=off',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=',
  '-c', 'diff.external=',
  '-c', 'core.pager=cat',
  '--no-pager',
];

/**
 * A revision typed by the user or read from settings. Rejects anything that git could parse as an
 * option (leading "-") or that contains characters never valid in refs / rev expressions we support.
 */
export function isSafeRev(rev: string | undefined): rev is string {
  if (!rev || rev.length > 200) return false;
  if (rev.startsWith('-')) return false;
  if (/[\s\x00-\x1f\x7f\\]|\.\.|@\{|\[|:/.test(rev)) return false;
  return /^[\w./@^~+-]+$/.test(rev);
}

export function git(root: string, args: string[], allowFail = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(gitPath, ['-C', root, ...SAFE_CONFIG, ...args],
      { maxBuffer: MAX, encoding: 'buffer', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (err, out) => {
        if (err && !allowFail) return reject(err);
        resolve(err ? '' : out.toString('utf8'));
      });
  });
}

/** Raw blob content of `<rev>:<path>` (or `:<path>` for the index). Uses cat-file: no textconv/filters. */
export async function show(root: string, spec: string): Promise<string | undefined> {
  const i = spec.indexOf(':');
  const rev = spec.slice(0, i);
  if (i < 0 || (rev !== '' && !isSafeRev(rev.replace(/\^$/, '')) && !/^[0-9a-f]{40,64}\^?$/.test(rev))) return undefined;
  return new Promise((resolve) => {
    execFile(gitPath, ['-C', root, ...SAFE_CONFIG, 'cat-file', 'blob', spec],
      { maxBuffer: MAX, encoding: 'buffer', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (err, out) => resolve(err ? undefined : out.toString('utf8')));
  });
}

const MD = ['--', '*.md', '*.markdown'];

/** Markdown files that differ between `rev` and the working tree (including untracked files). */
export async function changedVsRev(root: string, rev: string): Promise<string[]> {
  if (!isSafeRev(rev) && !/^[0-9a-f]{40,64}$/.test(rev)) return [];
  const [d, u] = await Promise.all([
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '-z', '--name-only', rev, ...MD], true),
    git(root, ['ls-files', '-z', '--others', '--exclude-standard', ...MD], true),
  ]);
  return [...new Set([...d.split('\0'), ...u.split('\0')].filter(Boolean))].sort();
}

/** Markdown files with unstaged changes (working tree vs index). */
export async function changedVsIndex(root: string): Promise<string[]> {
  const [d, u] = await Promise.all([
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '-z', '--name-only', ...MD], true),
    git(root, ['ls-files', '-z', '--others', '--exclude-standard', ...MD], true),
  ]);
  return [...new Set([...d.split('\0'), ...u.split('\0')].filter(Boolean))].sort();
}

/**
 * Target branch for the "as in the PR/MR" baseline when none is configured:
 * the remote's default branch (origin/HEAD), else the first of main / master / develop that exists.
 */
export async function defaultBranch(root: string): Promise<string | undefined> {
  const head = (await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], true)).trim();
  if (head) return head.replace(/^origin\//, '');
  for (const b of ['main', 'master', 'develop']) {
    if (await revExists(root, `origin/${b}`) || await revExists(root, b)) return b;
  }
  return undefined;
}

export async function mergeBase(root: string, branch: string): Promise<string | undefined> {
  if (!isSafeRev(branch)) return undefined;
  for (const ref of [`origin/${branch}`, branch]) {
    const out = (await git(root, ['merge-base', 'HEAD', ref], true)).trim();
    if (out) return out;
  }
  return undefined;
}

export async function revExists(root: string, rev: string): Promise<boolean> {
  if (!isSafeRev(rev)) return false;
  return (await git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], true)).trim() !== '';
}

export interface Commit { sha: string; author: string; date: string; subject: string; path: string }

export async function fileHistory(root: string, rel: string, limit = 200): Promise<Commit[]> {
  const out = await git(root, ['log', '--no-ext-diff', '--no-textconv', '--follow', `-n${limit}`, '--name-only', '--date=short',
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

/** Blame a line range (1-based, inclusive) -> the newest commit in that range. */
export async function blameRange(root: string, rel: string, start: number, end: number, rev?: string): Promise<BlameInfo | undefined> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 100000) return undefined;
  if (rev !== undefined && !/^[0-9a-f]{40,64}$/.test(rev)) return undefined;
  const out = await git(root, ['blame', '--no-textconv', '--porcelain', '-L', `${start},${end}`, ...(rev ? [rev] : []), '--', rel], true);
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
