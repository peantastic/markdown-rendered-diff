/**
 * Strings used inside the Review webview. The webview cannot call `vscode.l10n`,
 * so the extension translates this table once (English text = bundle key) and
 * embeds the result in the page. `{0}`, `{1}` are positional placeholders.
 */
export const WEBVIEW_STRINGS = {
  before: 'Before',
  after: 'After',
  diagramSourceDiff: 'Diagram source diff',
  diagramError: 'Could not render diagram: {0}',
  openSource: 'Open source line',
  markSeen: 'Mark this change as seen ( x )',
  askAi: 'Ask AI about this change ( a )',
  movedFrom: 'Moved from section “{0}”',
  movedTo: 'This block was moved to section “{0}”',
  topOfFile: 'top of file',
  unchangedBlock: '⋯ 1 unchanged block',
  unchangedBlocks: '⋯ {0} unchanged blocks',
  includesSections: ' · includes: {0}',
  andMore: ' and {0} more',
  clickToExpand: ' — click to expand',
  clickToCollapse: ' — click to collapse',
  unchangedRow: '⋯ 1 unchanged row — click to expand',
  unchangedRows: '⋯ {0} unchanged rows — click to expand',
  compareWith: 'Compared with: {0}',
  pressHelp: 'Press ? for keyboard shortcuts',
  addedBlocks: 'added blocks',
  removedBlocks: 'removed blocks',
  modifiedBlocks: 'modified blocks',
  movedBlocks: 'moved blocks',
  noChanges: 'no changes',
  seenOf: 'Seen {0}/{1} changes',
  seenCount: '{0} seen',
  uncommitted: 'Not committed yet',
  blameMore: 'this block has {0} commits; showing the latest',
  remoteImageBlocked: 'Remote image blocked (enable mdReview.allowRemoteImages to show it)',
  // toolbar + shortcut overlay (built by the extension, see src/panel/pageHtml.ts)
  viewUnified: 'Unified view ( s )',
  viewSplit: 'Side-by-side before / after ( s )',
  showAll: 'Show all unchanged blocks ( c )',
  prevChange: 'Previous change ( p )',
  nextChange: 'Next change ( n )',
  shortcutsButton: 'Keyboard shortcuts ( ? )',
  shortcuts: 'Keyboard shortcuts',
  keyNextPrev: 'Next / previous change (unseen first)',
  keySeen: 'Mark the selected change as seen',
  keyAskAi: 'Ask the AI about the selected change',
  keySplit: 'Unified ↔ side-by-side',
  keyCollapse: 'Collapse ↔ show unchanged blocks',
  keyViewed: 'Mark the whole file as viewed',
  keyFiles: 'Previous / next file',
  keyHelp: 'Open / close this panel',
  helpFooter: 'Hover a block for about a second to see who changed it (blame). ↗ opens the source line. Baseline, outline and viewed files live in the Markdown Rendered Diff sidebar.',
  notInBaseline: 'This file does not exist in the baseline (new file, or not present at that point).',
} as const;

export type WebviewStringKey = keyof typeof WEBVIEW_STRINGS;
export type WebviewStrings = Record<WebviewStringKey, string>;

/** Replace `{0}`, `{1}`… with the given arguments. */
export function format(s: string, ...args: (string | number)[]): string {
  return s.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}
