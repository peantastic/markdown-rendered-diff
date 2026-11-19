// Times diffMarkdown on every changed Markdown file of a repository. Usage: npx tsx scripts/bench.ts <repo>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffMarkdown } from '../src/diff/engine';
const root = process.argv[2];
const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { maxBuffer: 1 << 28 }).toString('utf8');
const files = git('diff', '-z', '--name-only', 'HEAD', '--', '*.md').split('\0').filter(Boolean);
let total = 0;
for (const f of files) {
  let old = '';
  try { old = git('show', `HEAD:${f}`); } catch {}
  const cur = readFileSync(join(root, f), 'utf8');
  const t = performance.now();
  const r = diffMarkdown(old, cur);
  const ms = performance.now() - t; total += ms;
  console.log(ms.toFixed(0).padStart(5), 'ms', JSON.stringify(r.stats), (cur.length/1024).toFixed(0)+'KB', f.split('/').pop());
}
console.log('total', total.toFixed(0), 'ms for', files.length, 'files');
