// Minimal `vscode` stub for unit tests.
// Extension-host modules do `import * as vscode from 'vscode'`. Pure-function tests
// (e.g. cachedDiff) never touch the API, so most of this just makes the import resolve.
// The DiffPanel message tests exercise the webview boundary, so window/commands/env
// expose real functions that those tests spy on, and createWebviewPanel returns a fake
// panel that captures the onDidReceiveMessage handler.

export const l10n = { t: (m: string, ...a: unknown[]) => m.replace(/\{(\d+)\}/g, (s, i) => String(a[Number(i)] ?? s)), bundle: undefined as any };
export const env = {
  language: 'en',
  openExternal: (_u: unknown): Promise<boolean> => Promise.resolve(true),
  clipboard: { writeText: (_t: string): Promise<void> => Promise.resolve() },
};
export const commands = {
  executeCommand: (..._a: unknown[]): Promise<unknown> => Promise.resolve(undefined),
};

export interface FakePanel {
  webview: any;
  posted: unknown[];
  fire(m: unknown): unknown; // invoke the captured onDidReceiveMessage handler
  title: string;
  iconPath: unknown;
  visible: boolean;
  reveal(): void;
  dispose(): void;
  onDidDispose(cb: () => void): { dispose(): void };
  onDidChangeViewState(cb: (e: unknown) => void): { dispose(): void };
}

/** Panels created since the last reset — tests read the latest to drive messages. */
export const createdPanels: FakePanel[] = [];

export const window = {
  showTextDocument: (..._a: unknown[]): Promise<unknown> => Promise.resolve(undefined),
  showWarningMessage: (..._a: unknown[]): Promise<unknown> => Promise.resolve(undefined),
  showInformationMessage: (..._a: unknown[]): Promise<unknown> => Promise.resolve(undefined),
  showErrorMessage: (..._a: unknown[]): Promise<unknown> => Promise.resolve(undefined),
  showQuickPick: (..._a: unknown[]): Promise<unknown> => Promise.resolve(undefined),
  showInputBox: (..._a: unknown[]): Promise<unknown> => Promise.resolve(undefined),
  createTerminal: (..._a: unknown[]): { show(): void; sendText(t: string): void } => ({ show() {}, sendText() {} }),
  createWebviewPanel(..._a: unknown[]): FakePanel {
    let onMsg: (m: unknown) => unknown = () => undefined;
    const panel: FakePanel = {
      posted: [],
      webview: {
        cspSource: 'vscode-webview://unit-test',
        asWebviewUri: (_u: unknown) => ({ toString: () => 'https://webview/resource' }),
        onDidReceiveMessage: (cb: (m: unknown) => unknown) => { onMsg = cb; return { dispose() {} }; },
        postMessage: (m: unknown) => { panel.posted.push(m); return Promise.resolve(true); },
        html: '',
      },
      fire: (m: unknown) => onMsg(m),
      title: '',
      iconPath: undefined,
      visible: true,
      reveal() {},
      dispose() {},
      onDidDispose: () => ({ dispose() {} }),
      onDidChangeViewState: () => ({ dispose() {} }),
    };
    createdPanels.push(panel);
    return panel;
  },
};

export const workspace = {
  workspaceFolders: undefined as any,
  getConfiguration: (_section?: string) => ({ get: (_k: string, d?: unknown) => d }),
};
export const extensions = {} as any;
export class Uri {
  constructor(public value = '') {}
  static file(p = '') { return new Uri(p); }
  static joinPath(_base: unknown, ...p: string[]) { return new Uri(p.join('/')); }
  static parse(s = '') { return new Uri(s); }
  toString() { return this.value; }
}
export class Position { constructor(public line = 0, public character = 0) {} }
export class Range { constructor(public start?: unknown, public end?: unknown) {} }
export const ViewColumn = { Active: -1, Beside: -2 } as any;
export const TreeItemCheckboxState = { Checked: 1, Unchecked: 0 } as any;
export default {};
