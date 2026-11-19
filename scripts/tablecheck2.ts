import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffMarkdown } from '../src/diff/engine';
const root = process.argv[2];
const git = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...a], { maxBuffer: 1 << 28 }).toString('utf8');
const files = git('diff', '-z', '--name-only', 'HEAD', '--', '*.md').split('\0').filter(Boolean);
const byKind: Record<string, number> = {};
for (const f of files) {
  let old = ''; try { old = git('show', `HEAD:${f}`); } catch {}
  const r = diffMarkdown(old, readFileSync(join(root, f), 'utf8'));
  for (const s of r.segments) if (s.kind !== 'eq') { const k = s.blockType + ':' + s.kind; byKind[k] = (byKind[k] ?? 0) + 1; }
}
console.log(byKind);
const diffstat = git('diff', '--numstat', 'HEAD', '--', '*.md');
console.log(diffstat.split('\n').slice(0,5).join('\n'));
