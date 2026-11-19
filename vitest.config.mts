import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Map `vscode` to a stub so unit tests can import extension-host modules
// (e.g. src/panel/diffPanel.ts for cachedDiff). The real API is only ever
// available inside VS Code; nothing in these tests calls it.
export default defineConfig({
  test: {
    alias: { vscode: fileURLToPath(new URL('./test/_vscode-mock.ts', import.meta.url)) },
  },
});
