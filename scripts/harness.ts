// Sinh trang HTML thử nghiệm webview với dữ liệu diff thật (mock acquireVsCodeApi).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffMarkdown } from '../src/diff/engine';
const [root, rel, out, mode, dark, scrollTo] = process.argv.slice(2);
const old = execFileSync('git', ['-C', root, 'show', `HEAD:${rel}`], { maxBuffer: 1 << 28 }).toString();
const cur = readFileSync(join(root, rel), 'utf8');
const d = diffMarkdown(old, cur);
const data = { key: rel, where: rel.slice(0, rel.lastIndexOf('/')), title: rel.split('/').pop(), sub: 'Commit gần nhất (HEAD)', working: true, stats: d.stats, segments: d.segments,
  viewed: false, seen: [d.segments.find(s => s.kind !== 'eq')?.id], pos: '3/21', hasPrev: true, hasNext: true,
  prefs: { mode: mode === 'split' ? 'split' : 'unified', collapse: mode !== 'all' } };
const tpl = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${process.cwd()}/media/review.css">
<style>:root{--vscode-editor-background:${dark ? '#1f1f1f' : '#fff'};--vscode-editor-foreground:${dark ? '#ccc' : '#222'};--vscode-font-family:sans-serif;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-textLink-foreground:#3794ff}</style></head>
<body class="${dark ? 'vscode-dark' : 'vscode-light'}">
<header id="bar">
  <div class="title"><b id="title"></b><span id="pos" class="muted"></span></div>
  <span id="stats"></span>
  <span class="spacer"></span>
  <span class="seg-group"><button id="mUnified" class="icon" title="Xem gộp ( s )"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h4"/></svg></button><button id="mSplit" class="icon" title="Xem 2 cột trước / sau ( s )"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M8 2.5v11M3.8 6h2.4M3.8 8.5h2.4M9.8 6h2.4M9.8 8.5h2.4"/></svg></button></span>
  <button id="only" class="toggle icon" title="Hiện hết các đoạn không đổi ( c )"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 6.5 8 2l5 4.5M3 9.5 8 14l5-4.5"/></svg></button>
  <span class="nav"><button id="prev" title="Thay đổi trước ( p )">◀</button><span id="cur" class="muted"></span><button id="next" title="Thay đổi sau ( n )">▶</button></span>
  <button id="helpBtn" title="Phím tắt ( ? )">?</button>
</header><div id="help" hidden><div class="help-box"></div></div>
<main id="content"></main><div id="ruler"></div><div id="tip"></div><base id="base" href="./">
<script>window.acquireVsCodeApi=()=>({postMessage(m){if(m.type==='ready')setTimeout(()=>window.postMessage({type:'render',resetScroll:true,data:DATA}),0)},getState(){},setState(){}});const DATA=${JSON.stringify(data)};</script>
<script src="${process.cwd()}/media/mermaid.min.js"></script><script src="${process.cwd()}/dist/webview.js"></script>
<script>setTimeout(()=>{const t=${JSON.stringify(scrollTo || '')};if(!t)return;const el=[...document.querySelectorAll('section.seg')].find(x=>x.textContent.includes(t));if(el)window.scrollTo(0,el.offsetTop-60)},300)</script></body></html>`;
writeFileSync(out, tpl);
console.log(JSON.stringify(d.stats));
