import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffPanel } from '../src/panel/diffPanel';
import type { DiffRequest, PanelHost } from '../src/panel/diffPanel';
// the alias maps 'vscode' to this same module, so these are the very objects DiffPanel calls
import { commands, createdPanels, env, Uri, window } from './_vscode-mock';

const ROOT = '/repo', REL = 'docs/a.md';

function makeHost() {
  return {
    state: {
      isViewed: () => false,
      seen: () => [] as string[],
      prefs: () => ({ mode: 'unified', collapse: true }),
      setSeen: vi.fn(),
      setPrefs: vi.fn(),
    },
    neighbours: () => ({ pos: '1/1', prev: undefined, next: undefined }),
    pickBaseline: vi.fn(),
    setViewed: vi.fn(),
    onOutline: vi.fn(),
    onSection: vi.fn(),
    renderHtml: () => true,
    allowRemoteImages: () => false,
  };
}

describe('DiffPanel.onMessage (untrusted webview input)', () => {
  let host: ReturnType<typeof makeHost>;
  let fire: (m: unknown) => unknown;

  beforeEach(async () => {
    createdPanels.length = 0;
    host = makeHost();
    const ctx = { extensionUri: Uri.file('/ext'), extensionPath: '/ext' } as any;
    const panel = new DiffPanel(ctx, host as unknown as PanelHost);
    const req: DiffRequest = {
      root: ROOT, rel: REL, title: 'a.md', sub: 'HEAD', working: true,
      load: async () => ({ old: '# a\n', new: '# b\n' }),
    };
    await panel.show(req);
    const fake = createdPanels.at(-1)!;
    fake.fire({ type: 'ready' });
    fire = (m) => fake.fire(m);
  });

  afterEach(() => vi.restoreAllMocks());

  it('ignores malformed messages', () => {
    expect(() => fire(null)).not.toThrow();
    expect(() => fire({})).not.toThrow(); // no type
    expect(() => fire({ type: 'unknown' })).not.toThrow();
  });

  it('dispatches valid control messages to the host', () => {
    fire({ type: 'seen', id: 'abc', value: true });
    expect(host.state.setSeen).toHaveBeenCalledWith(ROOT, REL, 'abc', true);

    fire({ type: 'prefs', prefs: { mode: 'split' } });
    expect(host.state.setPrefs).toHaveBeenCalledWith({ mode: 'split' });

    fire({ type: 'pickBaseline' });
    expect(host.pickBaseline).toHaveBeenCalled();
  });

  it('validates the openSource line number', () => {
    const spy = vi.spyOn(window, 'showTextDocument');
    for (const bad of [-1, 1.5, 'x', NaN, 2e9]) fire({ type: 'openSource', line: bad });
    expect(spy).not.toHaveBeenCalled();
    fire({ type: 'openSource', line: 10 });
    expect(spy).toHaveBeenCalled();
  });

  it('filters invalid outline items', () => {
    fire({ type: 'outline', items: [{ i: 0, level: 1, n: 2, text: 'ok' }, { bad: true }, null, 5] });
    expect(host.onOutline).toHaveBeenCalledWith([{ i: 0, level: 1, n: 2, text: 'ok' }]);
  });

  describe('link confinement', () => {
    it('opens http(s) externally but never other schemes', () => {
      const ext = vi.spyOn(env, 'openExternal');
      fire({ type: 'link', href: 'javascript:alert(1)' });
      fire({ type: 'link', href: 'file:///etc/passwd' });
      fire({ type: 'link', href: 'command:foo' });
      expect(ext).not.toHaveBeenCalled();
      fire({ type: 'link', href: 'https://example.com' });
      expect(ext).toHaveBeenCalledTimes(1);
    });

    it('opens relative links inside the repo', () => {
      const cmd = vi.spyOn(commands, 'executeCommand');
      fire({ type: 'link', href: 'sibling.md' });
      expect(cmd).toHaveBeenCalledWith('mdReview.open', expect.anything());
    });

    it('refuses links that escape the repository', () => {
      const cmd = vi.spyOn(commands, 'executeCommand');
      const warn = vi.spyOn(window, 'showWarningMessage');
      fire({ type: 'link', href: '../../etc/passwd' });
      expect(warn).toHaveBeenCalled();
      expect(cmd).not.toHaveBeenCalled();
    });
  });
});
