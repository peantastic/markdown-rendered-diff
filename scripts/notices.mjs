// Generates ThirdPartyNotices.txt for every package bundled into the extension
// (runtime dependencies and their transitive dependencies). Run: node scripts/notices.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const seen = new Map();
function walk(name, from) {
  let dir;
  try { dir = dirname(require.resolve(`${name}/package.json`, { paths: [from] })); } catch { return; }
  if (seen.has(dir)) return;
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  seen.set(dir, p);
  for (const d of Object.keys(p.dependencies ?? {})) walk(d, dir);
}
for (const d of Object.keys(root.dependencies)) walk(d, process.cwd());

const licenseText = (dir) => {
  const f = readdirSync(dir).find((n) => /^(licen[sc]e|copying)(\.|$)/i.test(n));
  return f ? readFileSync(join(dir, f), 'utf8').trim() : undefined;
};
const repo = (p) => (typeof p.repository === 'string' ? p.repository : p.repository?.url ?? p.homepage ?? '');

const entries = [...seen.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
let out = `Markdown Rendered Diff — third-party notices

This extension bundles the open-source packages listed below (mostly inside media/mermaid.min.js
and dist/extension.js). Each is distributed under its own license, reproduced here.

Note: elkjs (Eclipse Layout Kernel, bundled by Mermaid) is licensed under EPL-2.0 OR GPL-3.0-or-later.
It is included unmodified; its source code is available at https://github.com/kieler/elkjs.

`;
for (const [dir, p] of entries) {
  out += `${'='.repeat(78)}\n${p.name} ${p.version}\nLicense: ${p.license ?? JSON.stringify(p.licenses)}\n${repo(p)}\n${'-'.repeat(78)}\n`;
  out += (licenseText(dir) ?? '(no license file in the package; see the license field above)') + '\n\n';
}
writeFileSync('ThirdPartyNotices.txt', out);
console.log(`${entries.length} packages`);
