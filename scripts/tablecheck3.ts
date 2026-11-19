import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffMarkdown } from '../src/diff/engine';
const root = process.argv[2];
const git = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...a], { maxBuffer: 1 << 28 }).toString('utf8');
const files = git('diff', '-z', '--name-only', 'HEAD', '--', '*.md').split('\0').filter(Boolean);
let bad = 0, rowsAdd = 0, rowsDel = 0, cellsMod = 0;
for (const f of files) {
  let old = ''; try { old = git('show', `HEAD:${f}`); } catch {}
  const r = diffMarkdown(old, readFileSync(join(root, f), 'utf8'));
  for (const s of r.segments) {
    if (s.blockType !== 'table' || s.kind !== 'mod') continue;
    rowsAdd += (s.unified.match(/class="row-add"/g) ?? []).length;
    rowsDel += (s.unified.match(/class="row-del"/g) ?? []).length;
    cellsMod += (s.unified.match(/data-chg="mod"/g) ?? []).length;
    // mỗi ô có <del> phải thuộc hàng row-del hoặc là ô data-chg
    for (const cell of s.unified.split(/(?=<t[dh]\b)/)) {
      if (!cell.includes('<del>')) continue;
      if (/^<t[dh][^>]*data-chg=/.test(cell)) continue;
      const before = s.unified.slice(0, s.unified.indexOf(cell));
      const lastTr = before.lastIndexOf('<tr');
      if (before.slice(lastTr).startsWith('<tr class="row-del"')) continue;
      bad++; if (bad < 4) console.log('MISPLACED', f.split('/').pop(), cell.slice(0, 120));
    }
  }
}
console.log({ rowsAdd, rowsDel, cellsMod, misplacedDel: bad });
