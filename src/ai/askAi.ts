import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Turns a single change in the Review tab into a ready-to-use prompt and hands it to an
// AI assistant. Nothing here talks to a network: it only fills the clipboard, a VS Code chat
// view, or a terminal running the user's own CLI (claude, gemini, codex, aider, …).

export interface ChangeContext {
  root: string;
  rel: string;
  line?: number; // 0-based start line on the new side (falls back to the old side)
  section?: string; // nearest heading the change sits under
  kind: string; // add | del | mod | move
  oldText: string; // raw Markdown of the before side ('' when added)
  newText: string; // raw Markdown of the after side ('' when deleted)
}

interface Action {
  label: string;
  detail: string;
  instruction?: string; // omitted -> ask the user for a free-form question
}

const kindWord: Record<string, string> = { add: 'added', del: 'removed', mod: 'modified', move: 'moved', moveSrc: 'moved' };

function actions(): Action[] {
  return [
    { label: vscode.l10n.t('Explain'), detail: vscode.l10n.t('Explain what this change does and why'), instruction: vscode.l10n.t('Explain what this documentation change does and why it may have been made.') },
    { label: vscode.l10n.t('Plan'), detail: vscode.l10n.t('Draft a plan to implement this change'), instruction: vscode.l10n.t('Draft a concise, step-by-step plan to implement everything this documentation change describes.') },
    { label: vscode.l10n.t('Review'), detail: vscode.l10n.t('Review this change for problems'), instruction: vscode.l10n.t('Review this change: point out errors, inconsistencies, ambiguities, or anything that conflicts with the rest of the document.') },
    { label: vscode.l10n.t('Suggest a rewrite'), detail: vscode.l10n.t('Suggest a clearer version of the new text'), instruction: vscode.l10n.t('Suggest a clearer, more consistent rewrite of the updated text.') },
    { label: vscode.l10n.t('Ask a question…'), detail: vscode.l10n.t('Type your own question about this change') },
  ];
}

/** File + before/after + the chosen task, as plain text every assistant understands. */
function buildPrompt(cx: ChangeContext, instruction: string): string {
  const loc = cx.rel + (cx.line !== undefined ? `:${cx.line + 1}` : '');
  const where = loc + (cx.section ? `  (section “${cx.section}”)` : '');
  const parts = [`File: ${where}`, `Change type: ${kindWord[cx.kind] ?? cx.kind}`, ''];
  if (cx.oldText.trim()) parts.push('--- before ---', cx.oldText.trimEnd(), '');
  if (cx.newText.trim()) parts.push('--- after ---', cx.newText.trimEnd(), '');
  parts.push(`Task: ${instruction}`);
  return parts.join('\n');
}

export async function askAiAboutChange(cx: ChangeContext): Promise<void> {
  const list = actions();
  const picked = await vscode.window.showQuickPick(
    list.map((a) => ({ label: a.label, detail: a.detail, action: a })),
    { title: vscode.l10n.t('Ask AI about a change'), placeHolder: vscode.l10n.t('What should the AI do with this change?') });
  if (!picked) return;

  let instruction = picked.action.instruction;
  if (!instruction) {
    const typed = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Ask about this change'),
      placeHolder: vscode.l10n.t('e.g. Is this consistent with the rest of the document?'),
    });
    if (!typed) return;
    instruction = typed;
  }

  const prompt = buildPrompt(cx, instruction);
  const channel = vscode.workspace.getConfiguration('mdReview').get<string>('ai.channel', 'clipboard');
  if (channel === 'terminal') await sendToTerminal(cx.root, prompt);
  else if (channel === 'chat') await sendToChat(prompt);
  else await copyToClipboard(prompt);
}

async function copyToClipboard(prompt: string): Promise<void> {
  await vscode.env.clipboard.writeText(prompt);
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Prompt copied to the clipboard. Paste it into Claude, ChatGPT, Gemini or any AI assistant.'));
}

async function sendToChat(prompt: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
  } catch {
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(
      vscode.l10n.t('No chat view is available. The prompt was copied to the clipboard instead.'));
  }
}

/**
 * Writes the prompt to a temp file and launches the configured CLI with it as the first message.
 * The Markdown is untrusted, so it never reaches the command line directly: it stays a single
 * quoted argument via command substitution (assumes a POSIX shell or PowerShell — the defaults).
 */
async function sendToTerminal(cwd: string, prompt: string): Promise<void> {
  const cmd = (vscode.workspace.getConfiguration('mdReview').get<string>('ai.command', 'claude') || 'claude').trim();
  const file = join(tmpdir(), `md-review-ai-${randomBytes(6).toString('hex')}.txt`);
  writeFileSync(file, prompt, 'utf8');
  const term = vscode.window.createTerminal({ name: vscode.l10n.t('Ask AI'), cwd });
  term.show();
  const invocation = process.platform === 'win32'
    ? `${cmd} "$(Get-Content -Raw '${file}')"`
    : `${cmd} "$(cat '${file}')"`;
  term.sendText(invocation);
  void vscode.window.showInformationMessage(vscode.l10n.t('Sent the change to {0}.', cmd));
}
