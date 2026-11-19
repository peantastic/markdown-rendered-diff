// Collects every string passed to vscode.l10n.t / this.t in src/ plus the webview string table
// and writes l10n/bundle.l10n.json (English source). Run: node scripts/l10n-extract.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function collect(root = process.cwd()) {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(root, 'src'));
  const out = new Set();
  const call = /(?:l10n\.t|this\.t)\(\s*'((?:[^'\\]|\\.)*)'/g;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(call)) out.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  const table = readFileSync(join(root, 'src/i18n/webviewStrings.ts'), 'utf8');
  for (const m of table.matchAll(/^\s+\w+: '((?:[^'\\]|\\.)*)',$/gm)) out.add(m[1].replace(/\\'/g, "'"));
  return [...out].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = collect();
  writeFileSync('l10n/bundle.l10n.json', JSON.stringify(Object.fromEntries(keys.map((k) => [k, k])), null, 2) + '\n');
  console.log(`${keys.length} strings`);
}
