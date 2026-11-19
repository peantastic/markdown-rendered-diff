import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { claudeDataDir } from './baseline/baseline';
import { addHook, hasHook, hookCommand, removeHook, SCRIPT_NAME } from './claude/hookSettings';

// Optional integration with Claude Code (user-level, this machine only).
// The hook stores a copy of each Markdown file right before Claude edits it, per prompt turn,
// which powers the "Latest Claude Code turn" baseline. Nothing is installed unless the user confirms.

const settingsFile = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
// stable location so the path in settings.json survives extension updates
const scriptPath = () => join(dirname(settingsFile()), 'hooks', 'markdown-rendered-diff', SCRIPT_NAME);

function readSettings(): { json: any; error?: string } {
  const file = settingsFile();
  if (!existsSync(file)) return { json: {} };
  try {
    const text = readFileSync(file, 'utf8');
    return { json: text.trim() ? JSON.parse(text) : {} };
  } catch (e) {
    return { json: undefined, error: String(e) };
  }
}

function writeSettings(json: any) {
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, file + '.markdown-rendered-diff.bak');
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

export function claudeHookInstalled(): boolean {
  const { json } = readSettings();
  return !!json && hasHook(json);
}

export async function installClaudeHook(ctx: vscode.ExtensionContext): Promise<boolean> {
  const file = settingsFile();
  const enable = vscode.l10n.t('Enable');
  const ok = await vscode.window.showInformationMessage(
    vscode.l10n.t('Enable Claude Code turn tracking?'),
    {
      modal: true,
      detail: vscode.l10n.t(
        'This adds two hooks (UserPromptSubmit and PreToolUse for Edit/Write/MultiEdit) to {0}. Before Claude Code edits a Markdown file, a copy is saved under {1} (last 50 turns). A backup of settings.json is written first. You can remove it any time with "Disable Claude Code Turn Tracking".',
        file, claudeDataDir()),
    },
    enable);
  if (ok !== enable) return false;

  try {
    execFileSync('node', ['--version'], { stdio: 'ignore' });
  } catch {
    void vscode.window.showErrorMessage(vscode.l10n.t('Node.js was not found on PATH. Claude Code hooks run the script with "node"; install Node.js and try again.'));
    return false;
  }
  const { json, error } = readSettings();
  if (!json) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Could not parse {0} ({1}). Nothing was changed.', file, error ?? ''));
    return false;
  }
  const script = scriptPath();
  // forward slashes work for node on Windows and survive both cmd and Git Bash quoting
  const fwd = (x: string) => (process.platform === 'win32' ? x.replace(/\\/g, '/') : x);
  let command: string;
  try {
    command = hookCommand(fwd(script), fwd(claudeDataDir()));
  } catch (e) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Cannot install the hook: {0}', String((e as Error).message)));
    return false;
  }
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(join(ctx.extensionPath, 'hooks', SCRIPT_NAME), script);
  writeSettings(addHook(json, command));
  void vscode.window.showInformationMessage(vscode.l10n.t('Claude Code turn tracking is on. It applies to Claude Code sessions started from now on.'));
  return true;
}

export async function uninstallClaudeHook(): Promise<void> {
  const file = settingsFile();
  const { json, error } = readSettings();
  if (!json) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Could not parse {0} ({1}). Nothing was changed.', file, error ?? ''));
    return;
  }
  const removed = removeHook(json);
  if (removed) writeSettings(json);
  rmSync(dirname(scriptPath()), { recursive: true, force: true });

  const del = vscode.l10n.t('Delete snapshots');
  const dataDir = claudeDataDir();
  const choice = existsSync(dataDir)
    ? await vscode.window.showInformationMessage(
      removed ? vscode.l10n.t('Claude Code turn tracking is off.') : vscode.l10n.t('Claude Code turn tracking was not enabled.'),
      { detail: vscode.l10n.t('Saved snapshots are kept in {0}.', dataDir) }, del)
    : (void vscode.window.showInformationMessage(removed ? vscode.l10n.t('Claude Code turn tracking is off.') : vscode.l10n.t('Claude Code turn tracking was not enabled.')), undefined);
  if (choice === del) rmSync(dataDir, { recursive: true, force: true });
}
