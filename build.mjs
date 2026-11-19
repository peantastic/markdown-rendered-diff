import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('media', { recursive: true });
copyFileSync('node_modules/mermaid/dist/mermaid.min.js', 'media/mermaid.min.js');

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
