import { diffArrays } from 'diff';
import { Cell, Row, TableData, renderRow } from './blocks';
import { inlineDiff, wrapText } from './inlineDiff';
import { similarity, textOf, tokenizeHtml } from './tokenize';

interface Pair { o?: number; n?: number }

/** Căn 2 dãy theo LCS trên khoá; trong vùng thay thế thì ghép cặp bằng hàm match. */
export function align(oldKeys: string[], newKeys: string[], match: (o: number, n: number) => boolean): Pair[] {
  const out: Pair[] = [];
  let oi = 0, ni = 0;
  const parts = diffArrays(oldKeys, newKeys);
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const cnt = p.count ?? p.value.length;
    if (!p.added && !p.removed) {
      for (let x = 0; x < cnt; x++) out.push({ o: oi++, n: ni++ });
      continue;
    }
    // gom removed + added liền nhau thành 1 vùng thay thế
    let delN = 0, addN = 0;
    while (k < parts.length && (parts[k].added || parts[k].removed)) {
      const c = parts[k].count ?? parts[k].value.length;
      if (parts[k].removed) delN += c; else addN += c;
      k++;
    }
    k--;
    const olds = Array.from({ length: delN }, (_, x) => oi + x);
    let cur = 0;
    for (let x = 0; x < addN; x++) {
      const n = ni + x;
      const found = olds.findIndex((o, idx) => idx >= cur && match(o, n));
      if (found < 0) { out.push({ n }); continue; }
      for (; cur < found; cur++) out.push({ o: olds[cur] });
      out.push({ o: olds[found], n });
      cur = found + 1;
    }
    for (; cur < olds.length; cur++) out.push({ o: olds[cur] });
    oi += delN;
    ni += addN;
  }
  return out;
}

export interface TableDiffResult {
  unified: string;
  old: string;
  new: string;
  changed: boolean;
}

const insAll = (h: string) => wrapText(tokenizeHtml(h), 'ins');
const delAll = (h: string) => wrapText(tokenizeHtml(h), 'del'); // giữ tag trong ô -> vẫn cân bằng
const withChg = (c: Cell, html: string, chg?: string): Cell => ({ ...c, html, attrs: c.attrs + (chg ? ` data-chg="${chg}"` : '') });
const rowKey = (r: Row) => r.map((c) => textOf(c.html)).join('\u0001');
const rowRaw = (r: Row) => r.map((c) => c.tag + c.attrs + '\u0002' + c.html).join('\u0001');

interface Out { u: string; o: string; n: string; changed: boolean }

const span = (r: Row) => r.reduce((n, c) => n + (Number(/colspan\s*=\s*"?(\d+)/i.exec(c.attrs)?.[1]) || 1), 0);
/** Hàng giữ chỗ ở bên không có hàng này — để bảng 2 cột luôn thẳng hàng. */
const placeholder = (r: Row) => `<tr class="row-ph"><td colspan="${Math.max(span(r), 1)}"></td></tr>`;

function diffRows(A: Row[], B: Row[]): Out {
  const ak = A.map(rowKey), bk = B.map(rowKey);
  const pairs = align(ak, bk, (o, n) =>
    (A[o][0] && B[n][0] && textOf(A[o][0].html) === textOf(B[n][0].html) && textOf(A[o][0].html) !== '') ||
    similarity(ak[o], bk[n]) > 0.5);
  const res: Out = { u: '', o: '', n: '', changed: false };
  for (const p of pairs) {
    const ra = p.o !== undefined ? A[p.o] : undefined;
    const rb = p.n !== undefined ? B[p.n] : undefined;
    if (ra && rb) {
      if (rowRaw(ra) === rowRaw(rb)) {
        res.u += renderRow(rb, 'row-eq'); res.o += renderRow(ra, 'row-eq'); res.n += renderRow(rb, 'row-eq');
        continue;
      }
      // sửa: so từng ô theo vị trí
      const u: Cell[] = [], o: Cell[] = [], n: Cell[] = [];
      let any = false;
      for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
        const ca = ra[i], cb = rb[i];
        if (ca && cb) {
          const d = inlineDiff(ca.html, cb.html);
          const chg = d.changed || ca.attrs !== cb.attrs ? 'mod' : undefined;
          if (chg) any = true;
          u.push(withChg(cb, d.unified, chg)); o.push(withChg(ca, d.old, chg)); n.push(withChg(cb, d.new, chg));
        } else if (cb) {
          any = true;
          u.push(withChg(cb, insAll(cb.html), 'add')); n.push(withChg(cb, insAll(cb.html), 'add'));
        } else if (ca) {
          any = true;
          u.push(withChg(ca, delAll(ca.html), 'del')); o.push(withChg(ca, delAll(ca.html), 'del'));
        }
      }
      const cls = any ? 'row-mod' : '';
      if (any) res.changed = true;
      res.u += renderRow(u, cls); res.o += renderRow(o, cls); res.n += renderRow(n, cls);
    } else if (rb) {
      res.changed = true;
      res.u += renderRow(rb, 'row-add'); res.n += renderRow(rb, 'row-add'); res.o += placeholder(rb);
    } else if (ra) {
      res.changed = true;
      const del = ra.map((c) => ({ ...c, html: delAll(c.html) }));
      res.u += renderRow(del, 'row-del'); res.o += renderRow(del, 'row-del'); res.n += placeholder(ra);
    }
  }
  return res;
}

export function tableDiff(a: TableData, b: TableData): TableDiffResult {
  const head = diffRows(a.head, b.head);
  const body = diffRows(a.body, b.body);
  const wrap = (t: TableData, h: string, bd: string, hasHead: boolean) =>
    t.pre + t.open + t.colgroup + (hasHead ? `<thead>${h}</thead>` : '') + `<tbody>${bd}</tbody></table>` + t.post;
  const hasHead = a.head.length + b.head.length > 0;
  // pre/post (HTML quanh bảng) đổi thì diff chữ
  const pre = inlineDiff(a.pre, b.pre), post = inlineDiff(a.post, b.post);
  const unified = pre.unified + wrap({ ...b, pre: '', post: '' }, head.u, body.u, hasHead) + post.unified;
  return {
    unified,
    old: pre.old + wrap({ ...a, pre: '', post: '' }, head.o, body.o, a.head.length > 0) + post.old,
    new: pre.new + wrap({ ...b, pre: '', post: '' }, head.n, body.n, b.head.length > 0) + post.new,
    changed: head.changed || body.changed || pre.changed || post.changed || a.open !== b.open || a.colgroup !== b.colgroup,
  };
}

