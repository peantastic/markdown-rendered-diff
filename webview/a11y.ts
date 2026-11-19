// Small pure helpers for the Review webview's accessibility attributes.
// Kept DOM-free and side-effect-free so they can be unit tested in node.
import type { WebviewStringKey } from '../src/i18n/webviewStrings';

/** Maps a change kind to the (existing) translated label used as its accessible name. */
export const changeLabelKey: Record<string, WebviewStringKey> = {
  add: 'addedBlocks',
  del: 'removedBlocks',
  mod: 'modifiedBlocks',
  move: 'movedBlocks',
  moveSrc: 'movedBlocks',
};

/** aria-pressed value for a toggle button. */
export const ariaPressed = (on: boolean): 'true' | 'false' => (on ? 'true' : 'false');

/** Attributes (as a string) for the "changes seen" progress bar. `label` must already be escaped. */
export function progressAttrs(nSeen: number, n: number, label: string): string {
  return `role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${nSeen}" aria-label="${label}"`;
}
