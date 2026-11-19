# Changelog

## 0.6.0

- **Math, alerts and footnotes**: KaTeX math (`$…$`, `$$…$$`), GitHub alerts (`> [!NOTE]`, `[!WARNING]`…) and footnotes now render in the diff, with changes detected at the block level.
- **Ask AI about a change**: an ✨ button (and the `a` key) turns a single change into a ready-to-use prompt and delivers it via the clipboard, a VS Code chat view, or a terminal running your own CLI (`mdReview.ai.channel` / `mdReview.ai.command`). Nothing is sent over the network by the extension.
- **Compare with Clipboard**: diff the current Markdown file against the clipboard contents.
- **Open Rendered Diff** now also works from VS Code's built-in Markdown diff tabs (renders that exact original-vs-modified diff).
- **Export Rendered Diff**: save the current rendered diff as a single, self-contained `.html` (inlined styles, KaTeX fonts embedded, rendered Mermaid included) — open in any browser or print to PDF.
- Math support adds KaTeX fonts to the package (~0.3 MB).

## 0.5.0 — first public preview

- English UI with Vietnamese, Japanese and Simplified Chinese translations (follows the VS Code display language).
- "As in the PR/MR" baseline detects the target branch automatically (`origin/HEAD`, `main`, `master`, `develop`) unless `mdReview.mrBaseBranch` is set.
- Claude Code turn tracking is opt-in: confirmation dialog, settings backup, new **Disable** command, works on Windows, macOS and Linux.
- Restricted Mode support: no git and no raw HTML in untrusted workspaces.
- Remote images are blocked by default (`mdReview.allowRemoteImages`); only `http(s)` / `mailto` links open externally.
- New setting `mdReview.renderHtml`.
- Confirmation before rendering files larger than 2 MB.
- Security hardening (see SECURITY.md): DOMPurify sanitization, nonce-only CSP, validated webview messages and revisions, links confined to the repository, git run with repository-defined programs disabled, safer hook command quoting and private snapshot folder.
- Welcome messages when no repository is found or the workspace is not trusted.

## 0.4.x — personal builds

- Collapsed unchanged content, aligned side-by-side tables, Mermaid font fixes.
- Sidebar with changed files (tree / list, M/A/D badges), changed sections and file history.
- Per-change "seen" tracking, keyboard shortcuts, blame on hover.
