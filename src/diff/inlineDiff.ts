import { diffArrays } from 'diff';
import { isTag, tokenizeHtml } from './tokenize';

export interface InlineResult {
  unified: string; // new version with <ins> + removed text in <del>
  old: string; // old version, <del> only
  new: string; // new version, <ins> only
  changed: boolean;
}

/** Wrap consecutive text runs in <ins>/<del>; HTML tags stay outside so the markup is always balanced. */
export function wrapText(tokens: string[], tag: 'ins' | 'del'): string {
  let res = '';
  let buf = '';
  const flush = () => {
    if (buf) res += buf.trim() ? `<${tag}>${buf}</${tag}>` : buf;
    buf = '';
  };
  for (const t of tokens) {
    if (isTag(t)) {
      flush();
      res += t;
    } else buf += t;
  }
  flush();
  return res;
}

const insignificant = (toks: string[]) => {
  if (toks.some(isTag)) return false;
  const s = toks.join('').trim();
  return s.length === 0 || /^\p{P}$/u.test(s);
};

interface Region {
  eq?: string[];
  del: string[];
  ins: string[];
}

export function inlineDiff(oldHtml: string, newHtml: string): InlineResult {
  if (oldHtml === newHtml) return { unified: newHtml, old: oldHtml, new: newHtml, changed: false };
  const a = tokenizeHtml(oldHtml);
  const b = tokenizeHtml(newHtml);
  const parts = diffArrays(a, b);

  // Group into regions: [equal] or [removed + added]; lone whitespace/punctuation between two changes is merged into the change
  const regions: Region[] = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const last = regions[regions.length - 1];
    if (!p.added && !p.removed) {
      const between = last && !last.eq && k < parts.length - 1 && insignificant(p.value);
      if (between) {
        last.del.push(...p.value);
        last.ins.push(...p.value);
      } else regions.push({ eq: p.value, del: [], ins: [] });
      continue;
    }
    const r = last && !last.eq ? last : (regions.push({ del: [], ins: [] }), regions[regions.length - 1]);
    (p.removed ? r.del : r.ins).push(...p.value);
  }

  let unified = '', o = '', n = '';
  for (const r of regions) {
    if (r.eq) {
      const s = r.eq.join('');
      unified += s; o += s; n += s;
      continue;
    }
    unified += wrapText(r.del.filter((t) => !isTag(t)), 'del') + wrapText(r.ins, 'ins');
    o += wrapText(r.del, 'del');
    n += wrapText(r.ins, 'ins');
  }
  return { unified, old: o, new: n, changed: true };
}
