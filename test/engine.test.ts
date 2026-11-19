import { describe, expect, it } from 'vitest';
import { diffMarkdown } from '../src/diff/engine';
import { inlineDiff } from '../src/diff/inlineDiff';

const balanced = (html: string) => {
  const stack: string[] = [];
  const voids = new Set(['br', 'hr', 'img', 'input', 'col']);
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m;
    if (self || voids.has(tag)) continue;
    if (close) {
      if (stack.pop() !== tag) return false;
    } else stack.push(tag);
  }
  return stack.length === 0;
};

describe('inlineDiff', () => {
  it('đánh dấu đúng từ thay đổi trong câu tiếng Việt', () => {
    const d = inlineDiff('<p>Hệ thống cho phép đặt phòng.</p>', '<p>Hệ thống cho phép đặt và huỷ phòng.</p>');
    expect(d.unified).toContain('<ins>');
    expect(d.unified).not.toContain('<del>');
    expect(d.unified).toContain('và');
    expect(balanced(d.unified)).toBe(true);
  });

  it('tiếng Nhật: chỉ tô cụm thay đổi, không tô cả câu', () => {
    const d = inlineDiff('<p>担当者承認待ちの書類</p>', '<p>管理職承認待ちの書類</p>');
    expect(d.unified).toMatch(/<del>[^<]*担当者[^<]*<\/del>/);
    expect(d.unified).toMatch(/<ins>[^<]*管理職[^<]*<\/ins>/);
    expect(d.unified).toContain('書類');
    expect(d.unified).not.toMatch(/<ins>[^<]*書類/);
  });

  it('giữ HTML cân bằng khi thêm định dạng', () => {
    const d = inlineDiff('<p>đặt phòng trong tòa nhà</p>', '<p>đặt phòng trong <strong>toàn bộ</strong> tòa nhà</p>');
    for (const h of [d.unified, d.old, d.new]) expect(balanced(h)).toBe(true);
  });
});

describe('diffMarkdown', () => {
  it('file giống nhau -> không có thay đổi', () => {
    const r = diffMarkdown('# A\n\ntext\n', '# A\n\ntext\n');
    expect(r.stats).toEqual({ add: 0, del: 0, mod: 0, move: 0 });
  });

  it('thêm / xoá / sửa block', () => {
    const r = diffMarkdown('# T\n\nđoạn một\n\nđoạn bị xoá hoàn toàn khác\n', '# T\n\nđoạn một có sửa\n\n> ghi chú mới\n');
    expect(r.stats.mod).toBe(1);
    expect(r.stats.add + r.stats.del).toBeGreaterThan(0);
    const mod = r.segments.find((s) => s.kind === 'mod')!;
    expect(mod.newLine).toEqual([2, 3]);
  });

  it('bảng: xoá 1 hàng -> nguyên hàng đánh dấu xoá; ô đổi -> chỉ ô đó', () => {
    const oldT = '| Phòng | Sức chứa |\n|---|---|\n| A1 | 10 |\n| B2 | 20 |\n| C3 | 30 |\n';
    const newT = '| Phòng | Sức chứa |\n|---|---|\n| A1 | 12 |\n| C3 | 30 |\n';
    const r = diffMarkdown(oldT, newT);
    const seg = r.segments.find((s) => s.kind === 'mod')!;
    expect(seg.unified).toContain('class="row-del"');
    expect(seg.unified).toMatch(/<tr class="row-del"><td><del>B2<\/del><\/td><td><del>20<\/del><\/td><\/tr>/);
    expect(seg.unified).toMatch(/data-chg="mod"><del>10<\/del><ins>12<\/ins>/);
    expect(balanced(seg.unified)).toBe(true);
    expect(balanced(seg.old)).toBe(true);
    expect(balanced(seg.new)).toBe(true);
  });

  it('bảng: thêm cột', () => {
    const r = diffMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n', '| A | X | B |\n|---|---|---|\n| 1 | 9 | 2 |\n');
    const seg = r.segments.find((s) => s.kind === 'mod')!;
    expect(seg.unified).toContain('data-chg="add"');
    expect(seg.unified).toContain('<ins>9</ins>');
  });

  const htmlTable = (rows: string[]) =>
    '<table class="bd-table">\n<colgroup><col style="width:30%"><col style="width:70%"></colgroup>\n' +
    '<thead><tr><th scope="col">Khóa</th><th scope="col">Ý nghĩa</th></tr></thead>\n<tbody>\n' +
    rows.join('\n') + '\n</tbody>\n</table>\n';
  const r1 = '<tr><td><code>EDIT</code></td><td>Sửa phiếu</td></tr>';
  const r2 = '<tr><td><code>APPROVE</code></td><td>Phê duyệt phiếu ở 管理職確認待ち</td></tr>';
  const r3 = '<tr><td colspan="2">Ghi chú gộp ô</td></tr>';

  it('bảng HTML: thêm hàng -> nguyên hàng row-add, giữ class/colgroup/colspan', () => {
    const r = diffMarkdown(htmlTable([r1, r2, r3]), htmlTable([r1, '<tr><td><code>WITHDRAW</code></td><td>Rút phiếu</td></tr>', r2, r3]));
    const seg = r.segments.find((s) => s.kind === 'mod')!;
    expect(seg.blockType).toBe('table');
    expect(seg.unified).toContain('<tr class="row-add"><td><code>WITHDRAW</code></td><td>Rút phiếu</td></tr>');
    expect(seg.unified).toContain('class="bd-table"');
    expect(seg.unified).toContain('<colgroup>');
    expect(seg.unified).toContain('colspan="2"');
    expect(seg.unified).not.toContain('<del>');
    for (const h of [seg.unified, seg.old, seg.new]) expect(balanced(h)).toBe(true);
  });

  it('bảng HTML: sửa 1 ô -> chỉ ô đó; xoá hàng -> row-del', () => {
    const r = diffMarkdown(htmlTable([r1, r2, r3]),
      htmlTable([r1.replace('Sửa phiếu', 'Sửa / gửi phiếu'), r3]));
    const seg = r.segments.find((s) => s.kind === 'mod')!;
    expect(seg.unified).toMatch(/<tr class="row-mod"><td><code>EDIT<\/code><\/td><td data-chg="mod">Sửa <ins>[^<]*gửi[^<]*<\/ins>/);
    expect(seg.unified).toContain('<tr class="row-del">');
    expect(seg.unified).toMatch(/row-del"><td><code><del>APPROVE<\/del><\/code><\/td>/);
    // chữ bị xoá chỉ nằm trong hàng bị xoá
    expect(seg.unified.split('<tr').filter((t) => t.includes('<del>')).every((t) => t.startsWith(' class="row-del"'))).toBe(true);
  });

  it('bảng: hàng không đổi có row-eq; bản 2 cột có cùng số hàng ở 2 bên', () => {
    const r = diffMarkdown(htmlTable([r1, r2, r3]), htmlTable([r1, '<tr><td>NEW</td><td>x</td></tr>', r3]));
    const seg = r.segments.find((s) => s.kind === 'mod')!;
    expect(seg.unified).toContain('<tr class="row-eq">');
    const rows = (h: string) => (h.match(/<tr\b/g) ?? []).length;
    expect(rows(seg.old)).toBe(rows(seg.new));
    expect(seg.old + seg.new).toContain('row-ph');
  });

  it('bảng HTML không đổi -> eq', () => {
    const r = diffMarkdown('# A\n\n' + htmlTable([r1, r2]), '# A\n\n' + htmlTable([r1, r2]));
    expect(r.stats).toEqual({ add: 0, del: 0, mod: 0, move: 0 });
  });

  it('mermaid: sửa sơ đồ -> hiện trước/sau', () => {
    const r = diffMarkdown('```mermaid\ngraph TD\nA-->B\n```\n', '```mermaid\ngraph TD\nA-->C\n```\n');
    const seg = r.segments.find((s) => s.kind === 'mod')!;
    expect(seg.unified).toContain('mm-pair');
    expect(seg.unified.match(/mermaid-src/g)!.length).toBe(2);
  });

  it('nhận diện đoạn di chuyển', () => {
    const p = 'Đây là một đoạn văn khá dài sẽ được di chuyển sang mục khác.';
    const r = diffMarkdown(`# A\n\n${p}\n\n# B\n\nkhác\n`, `# A\n\n# B\n\nkhác\n\n${p}\n`);
    expect(r.stats.move).toBe(1);
    expect(r.segments.find((s) => s.kind === 'move')!.note).toContain('A');
  });

  it('frontmatter hiện thành khối code, số dòng không đổi', () => {
    const r = diffMarkdown('---\nname: a\n---\n\n# T\n', '---\nname: b\n---\n\n# T\n');
    expect(r.segments[0].unified).toContain('<pre>');
    expect(r.segments.find((s) => s.heading)!.newLine).toEqual([4, 5]);
  });

  it('id thay đổi ổn định giữa các lần chạy', () => {
    const a = diffMarkdown('x\n\ny\n', 'x\n\nz\n');
    const b = diffMarkdown('x\n\ny\n', 'x\n\nz\n');
    expect(a.segments.map((s) => s.id)).toEqual(b.segments.map((s) => s.id));
  });
});
