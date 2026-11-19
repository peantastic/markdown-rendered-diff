import { Block, escapeHtml, mermaidHtml, ParseOptions, parseBlocks } from './blocks';
import { inlineDiff } from './inlineDiff';
import { align, tableDiff } from './tableDiff';
import { similarity } from './tokenize';

export type SegKind = 'eq' | 'add' | 'del' | 'mod' | 'move' | 'moveSrc';

export interface Segment {
  id: string; // stable per content -> used to persist the per-change "seen" state
  kind: SegKind;
  blockType: string;
  unified: string;
  old: string; // old-side html ('' if none)
  new: string; // new-side html ('' if none)
  newLine?: [number, number];
  oldLine?: [number, number];
  heading?: { level: number; text: string };
  /** Moved block: heading text of the section it came from / went to ('' = top of file). */
  moveFrom?: string;
  moveTo?: string;
}

export interface DiffStats { add: number; del: number; mod: number; move: number }
export interface DiffResult { segments: Segment[]; stats: DiffStats }

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function mermaidPair(oldCode: string, newCode: string): string {
  const code = inlineDiff(escapeHtml(oldCode), escapeHtml(newCode)).unified;
  return (
    '<div class="mm-pair">' +
    `<div><div class="mm-label" data-i18n="before">Before</div>${mermaidHtml(oldCode)}</div>` +
    `<div><div class="mm-label" data-i18n="after">After</div>${mermaidHtml(newCode)}</div>` +
    `</div><details class="mm-code"><summary data-i18n="diagramSourceDiff">Diagram source diff</summary><pre><code>${code}</code></pre></details>`
  );
}

function modify(a: Block, b: Block): Omit<Segment, 'id' | 'kind' | 'blockType'> & { changed: boolean } {
  if (a.table && b.table) {
    const d = tableDiff(a.table, b.table);
    return { unified: d.unified, old: d.old, new: d.new, changed: d.changed };
  }
  if (a.mermaid !== undefined && b.mermaid !== undefined) {
    return { unified: mermaidPair(a.mermaid, b.mermaid), old: a.html, new: b.html, changed: true };
  }
  const d = inlineDiff(a.html, b.html);
  return { unified: d.unified, old: d.old, new: d.new, changed: d.changed };
}

export function diffMarkdown(oldSrc: string, newSrc: string, opts: ParseOptions = {}): DiffResult {
  const A = parseBlocks(oldSrc, opts);
  const B = parseBlocks(newSrc, opts);
  const pairs = align(A.map((x) => x.key), B.map((x) => x.key), (o, n) =>
    A[o].type === B[n].type && similarity(A[o].key, B[n].key) > 0.4);

  const segs: (Segment & { key: string })[] = [];
  const stats: DiffStats = { add: 0, del: 0, mod: 0, move: 0 };
  for (const p of pairs) {
    const a = p.o !== undefined ? A[p.o] : undefined;
    const b = p.n !== undefined ? B[p.n] : undefined;
    const base = {
      blockType: (b ?? a)!.type,
      newLine: b?.line ?? undefined,
      oldLine: a?.line ?? undefined,
      heading: (b ?? a)!.heading,
    };
    if (a && b) {
      if (a.key === b.key) {
        segs.push({ ...base, id: '', key: b.key, kind: 'eq', unified: b.html, old: a.html, new: b.html });
        continue;
      }
      const m = modify(a, b);
      const kind = m.changed ? 'mod' : 'eq';
      segs.push({ ...base, id: '', key: a.key + '\u0000' + b.key, kind, unified: m.unified, old: m.old, new: m.new });
    } else if (b) {
      segs.push({ ...base, id: '', key: b.key, kind: 'add', unified: b.html, old: '', new: b.html });
    } else if (a) {
      segs.push({ ...base, id: '', key: a.key, kind: 'del', unified: a.html, old: a.html, new: '' });
    }
  }

  // Detect moved blocks: removed in one place and added verbatim elsewhere
  const dels = new Map<string, number[]>();
  segs.forEach((s, i) => {
    if (s.kind === 'del' && s.key.length >= 30) dels.set(s.key, [...(dels.get(s.key) ?? []), i]);
  });
  const sectionAt = (idx: number) => {
    for (let i = idx; i >= 0; i--) if (segs[i].heading) return segs[i].heading!.text;
    return '';
  };
  segs.forEach((s, i) => {
    if (s.kind !== 'add') return;
    const src = dels.get(s.key)?.shift();
    if (src === undefined) return;
    s.kind = 'move';
    s.moveFrom = sectionAt(src);
    const d = segs[src];
    d.kind = 'moveSrc';
    d.moveTo = sectionAt(i);
    d.unified = '';
  });

  const seen = new Map<string, number>();
  for (const s of segs) {
    if (s.kind === 'add') stats.add++;
    else if (s.kind === 'del') stats.del++;
    else if (s.kind === 'mod') stats.mod++;
    else if (s.kind === 'move') stats.move++;
    const h = fnv(s.kind + '\u0000' + s.key);
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    s.id = n ? `${h}-${n}` : h;
  }
  return { segments: segs.map(({ key: _k, ...s }) => s), stats };
}
