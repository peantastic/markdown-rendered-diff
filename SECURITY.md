# Security

## Threat model

Markdown Rendered Diff renders documents from git repositories that you may not have written: a cloned project, a pull request branch, a file edited by an AI agent. The extension treats **document content, repository configuration and data passed back from the Review tab as untrusted**.

| Risk | Mitigation |
|---|---|
| Script injection through raw HTML in Markdown (`<script>`, `onerror=`, `javascript:` links, SVG events) | Content Security Policy allows only the extension's own scripts (per-load random nonce; no `unsafe-inline`, no `unsafe-eval`, no scripts from the workspace). All document HTML is additionally sanitized with DOMPurify. Mermaid runs with `securityLevel: 'strict'`. |
| Navigation, embedding or phishing UI (`<meta refresh>`, `<iframe>`, `<form>`, `<base>`, full-screen overlays) | Removed by the sanitizer; CSP sets `frame-src`, `form-action`, `object-src` to `'none'` and restricts `base-uri`; fixed/sticky positioning from document styles is neutralized. |
| Tracking pixels / data leaving the machine | Remote images are blocked unless the user enables `mdReview.allowRemoteImages` (user-level setting only; a workspace cannot turn it on). No network access is allowed by the CSP otherwise. No telemetry. |
| Links in documents running commands (`command:`, `vscode:`, `file:`) | Only `http(s)` and `mailto` links open externally; relative links open only if they resolve inside the repository. |
| Malicious repository config running programs through git (`core.fsmonitor`, external diff, textconv, pager, hooks) | Every git call disables these (`-c core.fsmonitor=false -c diff.external= -c core.hooksPath= --no-pager --no-ext-diff --no-textconv`); file content is read with `git cat-file blob`. git is never started in untrusted workspaces (Restricted Mode). Arguments are passed without a shell. |
| Option injection through revisions (`--output=…` as a branch name in settings or the "Other commit" box) | Revisions are validated (no leading `-`, restricted character set) before reaching git; the branch setting has a schema pattern. |
| Forged messages from the Review tab | Every message is type-checked; line numbers, ids and preferences are validated; outline data is size-limited. |
| Tampered extension state or snapshot index (path traversal) | Stored baselines are validated; snapshot paths must stay inside their folder; snapshot index entries must match `files/<n>.md`. |
| Claude Code hook (opt-in) | Installed only after an explicit confirmation; `settings.json` is backed up first; only our own entries are added/removed. Paths are single-quoted on POSIX and rejected on Windows if they contain characters the shell would expand. The hook never blocks Claude Code, ignores invalid input, skips files over 20 MB and stores snapshots in a private folder (`0700` / `0600`). |
| Supply chain | Runtime dependencies are bundled and listed in ThirdPartyNotices.txt; `npm audit` is clean; CI actions are pinned to commit SHAs with read-only permissions. |

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **Report a vulnerability** button (private security advisory) on the repository, with steps to reproduce. You should get an answer within a week.
