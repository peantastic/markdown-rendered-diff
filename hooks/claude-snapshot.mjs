#!/usr/bin/env node
// Claude Code hook (user level) installed by Markdown Rendered Diff.
// Saves a copy of a Markdown file right before Claude edits it, once per prompt turn.
//   UserPromptSubmit           -> start a new turn
//   PreToolUse Edit|Write|...  -> if this .md file has no snapshot in the current turn yet, save its current content
// Usage: node claude-snapshot.mjs <data-dir>
// Never blocks Claude: every error is ignored, always exits 0 and prints nothing.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const DIR = process.argv[2] || join(homedir(), '.cache', 'markdown-rendered-diff', 'claude');
const KEEP = 50;
const MAX_FILE = 20 * 1024 * 1024; // skip snapshots of unusually large files
const MAX_FILES_PER_TURN = 500;
const PRIVATE = { mode: 0o700, recursive: true }; // snapshots may contain private documents
const write = (p, data) => writeFileSync(p, data, { mode: 0o600 });

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const session = String(input.session_id || 'default').replace(/[^\w-]/g, '').slice(0, 80) || 'default';
  const curFile = join(DIR, `current-${session}`);
  mkdirSync(join(DIR, 'turns'), PRIVATE);

  const newTurn = () => {
    const id = `${Date.now()}-${session}`;
    write(curFile, id);
    return id;
  };

  if (input.hook_event_name === 'UserPromptSubmit') {
    newTurn();
    // prune old turns
    const turns = readdirSync(join(DIR, 'turns')).filter((t) => /^\d+-[\w-]+$/.test(t)).sort();
    for (const t of turns.slice(0, Math.max(0, turns.length - KEEP))) rmSync(join(DIR, 'turns', t), { recursive: true, force: true });
  } else if (input.hook_event_name === 'PreToolUse') {
    const ti = input.tool_input || {};
    let fp = ti.file_path || ti.notebook_path;
    if (typeof fp === 'string' && fp.length < 4096 && !fp.includes('\0') && /\.(md|markdown)$/i.test(fp)) {
      if (!isAbsolute(fp)) fp = resolve(input.cwd || process.cwd(), fp);
      let turn = existsSync(curFile) ? readFileSync(curFile, 'utf8').trim() : '';
      if (!/^\d+-[\w-]+$/.test(turn)) turn = newTurn();
      const tdir = join(DIR, 'turns', turn);
      mkdirSync(join(tdir, 'files'), PRIVATE);
      const idxPath = join(tdir, 'index.json');
      const index = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : {};
      if (!index[fp] && Object.keys(index).length < MAX_FILES_PER_TURN) {
        let snap = null;
        if (existsSync(fp)) {
          const st = statSync(fp);
          if (!st.isFile() || st.size > MAX_FILE) process.exit(0);
          snap = `files/${Object.keys(index).length}.md`;
          write(join(tdir, snap), readFileSync(fp));
        }
        index[fp] = { snap };
        write(idxPath, JSON.stringify(index, null, 1));
      }
    }
  }
} catch {
  /* ignore */
}
process.exit(0);
