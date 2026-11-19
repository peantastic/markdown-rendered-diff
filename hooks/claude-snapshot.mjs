#!/usr/bin/env node
// Hook Claude Code (cấp user): lưu bản trước khi Claude sửa file .md, theo từng lượt hỏi.
//   UserPromptSubmit           -> bắt đầu lượt mới
//   PreToolUse Edit|Write|...  -> nếu file .md chưa có snapshot trong lượt này thì lưu nội dung hiện tại
// Không bao giờ chặn Claude: mọi lỗi đều bị bỏ qua, luôn thoát mã 0, không in gì ra stdout.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const DIR = join(homedir(), '.cache', 'md-review', 'claude');
const KEEP = 50;

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const session = String(input.session_id || 'default').replace(/[^\w-]/g, '');
  const curFile = join(DIR, `current-${session}`);
  mkdirSync(join(DIR, 'turns'), { recursive: true });

  const newTurn = () => {
    const id = `${Date.now()}-${session}`;
    writeFileSync(curFile, id);
    return id;
  };

  if (input.hook_event_name === 'UserPromptSubmit') {
    newTurn();
    // dọn bớt lượt cũ
    const turns = readdirSync(join(DIR, 'turns')).sort();
    for (const t of turns.slice(0, Math.max(0, turns.length - KEEP))) rmSync(join(DIR, 'turns', t), { recursive: true, force: true });
  } else if (input.hook_event_name === 'PreToolUse') {
    const ti = input.tool_input || {};
    let fp = ti.file_path || ti.notebook_path;
    if (fp && /\.(md|markdown)$/i.test(fp)) {
      if (!isAbsolute(fp)) fp = resolve(input.cwd || process.cwd(), fp);
      const turn = existsSync(curFile) ? readFileSync(curFile, 'utf8').trim() : newTurn();
      const tdir = join(DIR, 'turns', turn);
      mkdirSync(join(tdir, 'files'), { recursive: true });
      const idxPath = join(tdir, 'index.json');
      const index = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : {};
      if (!index[fp]) {
        let snap = null;
        if (existsSync(fp) && statSync(fp).isFile()) {
          snap = `files/${Object.keys(index).length}.md`;
          writeFileSync(join(tdir, snap), readFileSync(fp));
        }
        index[fp] = { snap };
        writeFileSync(idxPath, JSON.stringify(index, null, 1));
      }
    }
  }
} catch {
  /* bỏ qua */
}
process.exit(0);
