import { describe, expect, it } from 'vitest';
import { addHook, hasHook, hookCommand, removeHook } from '../src/claude/hookSettings';

const other = { type: 'command', command: 'echo other' };

describe('Claude Code hook settings', () => {
  it('adds both hooks and keeps unrelated settings and hooks', () => {
    const json: any = { model: 'x', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [other] }] } };
    addHook(json, hookCommand('/h/claude-snapshot.mjs', '/data', 'linux'));
    expect(json.model).toBe('x');
    expect(json.hooks.PreToolUse).toHaveLength(2);
    expect(json.hooks.PreToolUse[0].hooks[0]).toEqual(other);
    expect(json.hooks.UserPromptSubmit[0].hooks[0].command).toBe("node '/h/claude-snapshot.mjs' '/data'");
    expect(hasHook(json)).toBe(true);
  });
  it('re-installing does not duplicate (also replaces an older path)', () => {
    const json: any = {};
    addHook(json, 'node "/old/claude-snapshot.mjs"');
    addHook(json, 'node "/new/claude-snapshot.mjs" "/d"');
    expect(json.hooks.UserPromptSubmit).toHaveLength(1);
    expect(json.hooks.PreToolUse).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain('/old/');
  });
  it('removes only our entries and cleans up empty structures', () => {
    const json: any = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [other] }] } };
    addHook(json, 'node "/h/claude-snapshot.mjs"');
    expect(removeHook(json)).toBe(2);
    expect(json).toEqual({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [other] }] } });
    expect(hasHook(json)).toBe(false);
    const only: any = {};
    addHook(only, 'node "/h/claude-snapshot.mjs"');
    removeHook(only);
    expect(only).toEqual({});
  });
});

describe('hook command quoting', () => {
  it('POSIX: single quotes neutralise $, backticks and quotes', () => {
    expect(hookCommand("/home/a b/$(x)`y`/it's.mjs", '/d', 'linux')).toBe("node '/home/a b/$(x)`y`/it'\\''s.mjs' '/d'");
  });
  it('Windows: double quotes, rejects characters cmd would expand', () => {
    expect(hookCommand('C:/Users/A B/x.mjs', 'C:/d', 'win32')).toBe('node "C:/Users/A B/x.mjs" "C:/d"');
    expect(() => hookCommand('C:/%PATH%/x.mjs', 'C:/d', 'win32')).toThrow();
    expect(() => hookCommand('C:/a"b/x.mjs', 'C:/d', 'win32')).toThrow();
  });
  it('rejects newlines on every platform', () => {
    expect(() => hookCommand('/a\nrm -rf ~', '/d', 'linux')).toThrow();
  });
});
