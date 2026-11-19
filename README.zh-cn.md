# Markdown Rendered Diff

[English](README.md) · [Tiếng Việt](README.vi.md) · [日本語](README.ja.md) · 简体中文

以**渲染后的效果**审阅 Markdown 更改,而不是查看源码差异。

- 段落、列表、标题的逐词差异,良好支持中文、日文和越南语 (使用 `Intl.Segmenter` 分词)。
- 表格:突出显示新增 / 删除的行以及被修改的单元格 (也支持带 `colspan`/`rowspan` 的 HTML 表格)。
- Mermaid 图并排显示修改前 / 修改后,并可查看图表源码差异。
- 合并 / 并排视图 (`s`)、折叠未更改的块 (`c`)、逐项标记已查看 (`x`) 以及整个文件已查看 (`v`)。
- 侧边栏:**已更改文件** (树形 / 列表,M/A/D 标记)、**已更改章节**、**文件历史**。
- 基准:HEAD、自上次审阅以来、与 PR/MR 一致、未暂存、任意提交/分支、最近一次 Claude Code 轮次 (可选)。
- 鼠标在块上停留约 1 秒即可查看 blame。

**开始使用:** 打开包含 git 仓库的文件夹,点击活动栏中的 **Markdown Diff**,或打开 `.md` 文件后点击 **打开渲染差异** 按钮 / `Alt+Shift+D`。在 Review 标签页中按 `?` 查看快捷键。

**Claude Code 轮次跟踪 (可选,默认关闭):** 运行命令“启用 Claude Code 轮次跟踪…”并确认后,扩展会向 `~/.claude/settings.json` 添加两个钩子 (修改前先备份),在 Claude 编辑 `.md` 文件之前保存副本。可通过“禁用”命令移除。

**隐私:** 无遥测。除非启用 `mdReview.allowRemoteImages`,否则阻止远程图片。受限模式下不运行 git,也不渲染原始 HTML。

完整说明 (设置、限制、参与开发) 请参阅 [英文 README](README.md)。
