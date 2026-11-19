// Split HTML into tokens: tags, entities and words (Intl.Segmenter, so CJK text is not lumped into one token).
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const TAG_OR_ENTITY = /(<[^>]+>|&#?\w+;)/;

export function isTag(t: string): boolean {
  return t.length > 1 && t[0] === '<' && t[t.length - 1] === '>';
}

export function tokenizeHtml(html: string): string[] {
  const out: string[] = [];
  for (const part of html.split(TAG_OR_ENTITY)) {
    if (!part) continue;
    if (TAG_OR_ENTITY.test(part) && (isTag(part) || part[0] === '&')) {
      out.push(part);
      continue;
    }
    for (const s of segmenter.segment(part)) out.push(s.segment);
  }
  return out;
}

/** Strip tags and decode common entities — used as comparison key. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

/** Similarity 0..1 (Dice coefficient on character bigrams) — fast enough to pair blocks/rows. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g);
    if (n) { hit++; grams.set(g, n - 1); }
  }
  return (2 * hit) / (a.length + b.length - 2);
}
