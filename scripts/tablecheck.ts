import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffMarkdown } from '../src/diff/engine';
import { parseBlocks } from '../src/diff/blocks';
const root = process.argv[2];
const git = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...a], { maxBuffer: 1 << 28 }).toString('utf8');
const files = git('diff', '-z', '--name-only', 'HEAD', '--', '*.md').split('\0').filter(Boolean);
let tables = 0, invisible = 0, eqButChanged = 0;
for (const f of files) {
  let old = ''; try { old = git('show', `HEAD:${f}`); } catch {}
  const cur = readFileSync(join(root, f), 'utf8');
  const r = diffMarkdown(old, cur);
  for (const s of r.segments) {
    if (s.blockType !== 'table') continue;
    if (s.kind === 'mod') {
      tables++;
      if (!/<ins>|<del>|row-add|row-del|col-add|col-del/.test(s.unified)) { invisible++; console.log('INVISIBLE', f.split('/').pop(), s.newLine); }
    }
  }
  // bảng có source khác nhau nhưng bị coi là "eq"
  const A = parseBlocks(old), B = parseBlocks(cur);
  const aKeys = new Set(A.filter(b => b.table).map(b => b.key));
  for (const s of r.segments) if (s.blockType === 'table' && s.kind === 'eq' && s.newLine) {
    const src = cur.split('\n').slice(s.newLine[0], s.newLine[1]).join('\n').trim();
    if (!aKeys.has(src)) { eqButChanged++; console.log('EQ-BUT-CHANGED', f.split('/').pop(), s.newLine); }
  }
}
console.log({ tables, invisible, eqButChanged });
