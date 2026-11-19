// Pure helpers that edit a Claude Code settings.json object (no I/O, no vscode) — unit tested.

export const SCRIPT_NAME = 'claude-snapshot.mjs';
export const EVENTS: { event: string; matcher?: string }[] = [
  { event: 'UserPromptSubmit' },
  { event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit' },
];

const ours = (h: any) => String(h?.command ?? '').includes(SCRIPT_NAME);

/** Quote a path for a shell command line (POSIX sh and Windows cmd both accept double quotes). */
export function quote(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

export function hookCommand(script: string, dataDir: string): string {
  return `node ${quote(script)} ${quote(dataDir)}`;
}

/** Remove our hook entries (any older path too); drop groups and events that become empty. Returns how many were removed. */
export function removeHook(json: any): number {
  let removed = 0;
  const hooks = json?.hooks;
  if (!hooks || typeof hooks !== 'object') return 0;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      const list = Array.isArray(g?.hooks) ? g.hooks : [];
      const rest = list.filter((h: any) => !ours(h));
      removed += list.length - rest.length;
      if (rest.length || !list.length) kept.push(rest.length === list.length ? g : { ...g, hooks: rest });
    }
    if (kept.length) hooks[event] = kept; else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete json.hooks;
  return removed;
}

/** Add our hook entries (replacing any previous copy), keeping every other hook untouched. */
export function addHook(json: any, command: string): any {
  removeHook(json);
  json.hooks ??= {};
  for (const { event, matcher } of EVENTS) {
    (json.hooks[event] ??= []).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 10 }] });
  }
  return json;
}

export function hasHook(json: any): boolean {
  return Object.values(json?.hooks ?? {}).some((groups: any) =>
    Array.isArray(groups) && groups.some((g: any) => Array.isArray(g?.hooks) && g.hooks.some(ours)));
}
