// Builds a self-contained, script-free HTML document from the rendered diff body
// (captured from the webview) plus inlined stylesheets. Openable in any browser / printable to PDF.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Light, VS-Code-independent defaults so review.css's `var(--vscode-*)` resolve outside the editor. */
const OVERRIDE = `
:root{
  --vscode-editor-background:#fff;--vscode-editor-foreground:#1f2328;
  --vscode-font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
  --vscode-markdown-font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
  --vscode-editor-font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  --vscode-textLink-foreground:#0969da;--vscode-panel-border:rgba(128,128,128,.35);
  --vscode-descriptionForeground:#656d76;--vscode-editorWidget-background:#f6f8fa;
  --vscode-textCodeBlock-background:rgba(128,128,128,.12);--vscode-focusBorder:#0969da;
  --vscode-button-background:#0969da;--vscode-button-foreground:#fff;
}
body{margin:0;background:#fff;color:#1f2328;}
#bar,#ruler,#tip,#help,.gutter,.g-seen,.g-src{display:none!important;}
#content{padding:24px!important;max-width:1000px;margin:0 auto;}
section.seg{outline:none!important;}
`;

export interface ExportInput {
  title: string;
  /** Rendered diff body captured from the webview (#content innerHTML). */
  bodyHtml: string;
  reviewCss: string;
  /** KaTeX CSS (with fonts inlined as data URIs); omit when the document has no math. */
  katexCss?: string;
}

export function buildExport(o: ExportInput): string {
  const css = `${o.katexCss ?? ''}\n${o.reviewCss}\n${OVERRIDE}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<style>${css}</style>
</head>
<body><main id="content">${o.bodyHtml}</main></body></html>`;
}
