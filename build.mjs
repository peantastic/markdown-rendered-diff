import * as esbuild from 'esbuild';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('media', { recursive: true });
copyFileSync('node_modules/mermaid/dist/mermaid.min.js', 'media/mermaid.min.js');
// KaTeX stylesheet + fonts for rendered math (CSS references fonts/ relatively)
mkdirSync('media/katex', { recursive: true });
copyFileSync('node_modules/katex/dist/katex.min.css', 'media/katex/katex.min.css');
// VS Code (Chromium) uses woff2; drop the woff/ttf fallbacks to keep the package small
cpSync('node_modules/katex/dist/fonts', 'media/katex/fonts', { recursive: true, filter: (s) => !/\.(woff|ttf)$/.test(s) });

const common = { bundle: true, sourcemap: false, minify: !watch, logLevel: 'info' };
const ctxs = await Promise.all([
  esbuild.context({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }),
  esbuild.context({ ...common, entryPoints: ['webview/main.ts'], outfile: 'dist/webview.js', platform: 'browser', format: 'iife', target: 'es2022' }),
]);
if (watch) await Promise.all(ctxs.map((c) => c.watch()));
else {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  await Promise.all(ctxs.map((c) => c.dispose()));
}
