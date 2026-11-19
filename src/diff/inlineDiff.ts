import { diffArrays } from 'diff';
import { isTag, tokenizeHtml } from './tokenize';

export interface InlineResult {
  unified: string; // bản mới có <ins> + text bị xoá trong <del>
  old: string; // bản cũ, chỉ đánh <del>
  new: string; // bản mới, chỉ đánh <ins>
  changed: boolean;
}

/** Bọc các đoạn text liên tiếp bằng <ins>/<del>; tag HTML để nguyên ở ngoài để HTML luôn cân bằng. */
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

  // Gom thành các vùng: [bằng nhau] hoặc [xoá + thêm]; khoảng trắng/dấu câu lẻ nằm giữa 2 thay đổi được gộp vào thay đổi
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
