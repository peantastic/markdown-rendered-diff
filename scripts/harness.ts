// Builds a standalone HTML page of the Review webview with a real diff (mocked acquireVsCodeApi),
// for screenshots with headless Chrome.
// Usage: npx tsx scripts/harness.ts <oldFile|repo> <newFile|rel> <out.html> [unified|split|all] [dark] [lang] [where]
//   - two files: diff old -> new
//   - repo + rel: diff HEAD:rel -> working tree
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { diffMarkdown } from '../src/diff/engine';
import { pageBody, i18nScript } from '../src/panel/pageHtml';
import { WEBVIEW_STRINGS, WebviewStrings } from '../src/i18n/webviewStrings';

const [a, b, out, mode = 'unified', dark = '', lang = 'en', where] = process.argv.slice(2);
let old: string, cur: string, rel: string;
if (existsSync(a) && statSync(a).isDirectory()) {
  rel = b;
  old = execFileSync('git', ['-C', a, 'show', `HEAD:${b}`], { maxBuffer: 1 << 28 }).toString();
  cur = readFileSync(join(a, b), 'utf8');
} else {
  rel = b;
  old = readFileSync(a, 'utf8');
  cur = readFileSync(b, 'utf8');
}
const strings = { ...WEBVIEW_STRINGS } as WebviewStrings;
if (lang !== 'en') {
  const bundle = JSON.parse(readFileSync(`l10n/bundle.l10n.${lang}.json`, 'utf8'));
  for (const k of Object.keys(strings) as (keyof WebviewStrings)[]) strings[k] = bundle[strings[k]] ?? strings[k];
}
const d = diffMarkdown(old, cur);
const firstChange = d.segments.find((s) => s.kind !== 'eq');
const data = {
  key: rel, where: where ?? 'docs/specs', title: basename(rel), sub: 'HEAD', working: true, stats: d.stats, segments: d.segments,
  viewed: false, seen: firstChange ? [firstChange.id] : [], pos: '2/5', hasPrev: true, hasNext: true,
  prefs: { mode: mode === 'split' ? 'split' : 'unified', collapse: mode !== 'all' },
};
const cwd = process.cwd();
const page = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><link rel="stylesheet" href="${cwd}/media/review.css">
<style>:root{--vscode-editor-background:${dark ? '#1f1f1f' : '#ffffff'};--vscode-editor-foreground:${dark ? '#cccccc' : '#1f1f1f'};--vscode-font-family:-apple-system,"Segoe UI","Noto Sans","Noto Sans CJK JP",sans-serif;--vscode-font-size:13px;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-textLink-foreground:${dark ? '#4daafc' : '#005fb8'};--vscode-descriptionForeground:${dark ? '#9d9d9d' : '#616161'};--vscode-panel-border:${dark ? '#3c3c3c' : '#e5e5e5'}}</style></head>
<body class="${dark ? 'vscode-dark' : 'vscode-light'}">
${pageBody(strings)}
${i18nScript(lang, strings)}
<base id="base" href="${resolve(rel, '..')}/">
<script>window.acquireVsCodeApi=()=>({postMessage(m){if(m.type==='ready')setTimeout(()=>window.postMessage({type:'render',resetScroll:true,data:DATA}),0)},getState(){},setState(){}});const DATA=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script src="${cwd}/media/mermaid.min.js"></script><script src="${cwd}/dist/webview.js"></script>
</body></html>`;
writeFileSync(out, page);
console.log(JSON.stringify(d.stats));
