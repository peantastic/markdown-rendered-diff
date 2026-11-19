# Changelog

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
