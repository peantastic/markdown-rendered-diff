# Markdown Rendered Diff

[English](README.md) · Tiếng Việt · [日本語](README.ja.md) · [简体中文](README.zh-cn.md)

Review thay đổi Markdown **ở dạng đã render** như người đọc thấy, thay vì diff mã nguồn.

- Diff từng từ trong đoạn văn, danh sách, tiêu đề; hỗ trợ tốt tiếng Việt, Nhật, Trung.
- Bảng: tô đúng hàng thêm / xoá và từng ô bị sửa (cả bảng HTML có `colspan`/`rowspan`).
- Sơ đồ Mermaid hiện trước / sau cạnh nhau, kèm diff mã nguồn sơ đồ.
- Xem gộp hoặc 2 cột (`s`), thu gọn phần không đổi (`c`), đánh dấu đã xem từng thay đổi (`x`) và cả file (`v`).
- Thanh bên: **File thay đổi** (cây / danh sách, nhãn M/A/D), **Mục lục thay đổi**, **Lịch sử file**.
- Mốc so sánh: HEAD, từ lần review trước, như trên PR/MR, phần chưa stage, commit/branch bất kỳ, lượt Claude Code gần nhất (tuỳ chọn).
- Rê chuột ~1 giây để xem blame.

**Bắt đầu:** mở thư mục có git repo → bấm biểu tượng **Markdown Diff** ở thanh hoạt động, hoặc mở file `.md` rồi bấm nút **Mở diff dạng preview** / `Alt+Shift+D`. Bấm `?` trong tab Review để xem phím tắt.

**Theo dõi lượt Claude Code (tuỳ chọn, mặc định tắt):** chạy lệnh *Bật theo dõi lượt Claude Code…* và xác nhận. Extension sẽ thêm 2 hook vào `~/.claude/settings.json` (có sao lưu trước) để lưu bản trước khi Claude sửa file `.md`. Gỡ bằng lệnh *Tắt theo dõi lượt Claude Code*.

**Quyền riêng tư:** không telemetry; ảnh từ internet bị chặn trừ khi bật `mdReview.allowRemoteImages`; ở Restricted Mode không chạy git và không render HTML thô.

Chi tiết đầy đủ (settings, giới hạn, đóng góp): xem [README tiếng Anh](README.md).
