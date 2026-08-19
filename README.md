# dsh-course-logic-extractor

「课程逻辑提取器」agent 预设的 dsh 插件版：读取一门课程/论文的资料（大纲、讲义、课件、字幕、习题、论文 PDF 等），还原它的设计逻辑——先教什么、后教什么、每个环节为什么放在那里、环节之间如何衔接，交付自洽的逻辑链分析报告 + 学习路线图 + 流程画布，让学习者在正式深入之前先看清全局。

安装后，预设 `course-logic-extractor` 会自动出现在 DSH 的预设选择器中，随插件分发到任何机器。

## 功能特性

- **三种输入模式**：直接分析（给资料路径）· 论文模式（双视角：研究逻辑 + 学习逻辑）· 自主找资料（无资料时按学习需求走迭代确认制流程）
- **入口分流（意图理解）**：按用户首条消息直接判断——给资料路径走标准流程、给学习需求（任何表达「想获得知识/技能/理解」的意图都算，不必出现「学」字，目的不是必要条件）走自主流程、两者都没给则先介绍本 agent 用法
- **自主找资料（迭代确认制）**：阶段一确定**能力点清单**（多层树形结构：一级并列 + 从属子能力点；过大能力点分解至可学习可检验的叶子；叶子标注前置/后置依赖与**掌握标准**；依赖图必产）→ 阶段二确定**资料清单**（先问学习形态偏好：书籍自学/视频为主/AI 决定/其他；七列固定：覆盖能力点｜名称｜来源｜链接/位置｜形态｜价值评估｜状态）→ 资料落地（本地优先 → 网络下载 → 缺失由用户决断）；每阶段以用户明确表态「完全确定」为唯一出口，规划留档于 `0-规划/`
- **材料管线**：PDF 渲染（MuPDF）→ OCR 转录（GLM-OCR）→ 质量对账 → 直出归档 → **优化稿可选**（直出后主动询问用户是否需要；仅为便于 Obsidian 阅读的易读性增强，与其他产出物无关，不需要可直接读 PDF 原件）
- **交付物**：逻辑链分析（七节 + frontmatter + 自检）· 学习路线图 · 流程图 canvas 集（`1-报告/画布/`）· 证据层 · 材料层（含质量报告）
- **工程保障**：单元测试（node:test）、CI（GitHub Actions 自动跑测试 + tag 自动发 Release）

## 安装

```sh
dsh plugin --profile web add github:ShadowBruceMeaningLau/dsh-course-logic-extractor
```

重启 `dsh web`（或任何使用 agent presets 的界面）。新建会话时在预设选择器里选「课程逻辑提取器」即可。

## OCR 密钥（必需，否则转录功能不可用）

OCR 走智谱 GLM-OCR（`glm-ocr`，专用端点 `layout_parsing`）。两种配置方式任选其一：

1. 环境变量：`ZHIPU_API_KEY`；或
2. 配置文件：`~/.dsh/free-vision.json` 增加字段 `{"zhipuApiKey": "…"}`

免费申请：https://open.bigmodel.cn 。缺密钥时技能会明确提示用户补充，不影响其余功能（盘点、纯文本资料分析、网页抓取等）。

## 工作原理

- 插件本体是一个极小的宿主半边：启动时把内置的预设目录（`preset/course-logic-extractor/`）幂等落盘到 DSH 的用户预设根 `~/.dsh/.agent-presets/`，预设选择器随即发现它。
- **不覆盖你的本地修改**：目标位置已存在**没有** `.dsh-plugin` 标记的预设（比如你自己写的版本）时，插件不碰它；只有插件自己装过的副本才会在版本升级时更新。
- 预设组合（`agent.cordis.yml`）引用官方 `@deepseek-ai/dsh-*` 包（由宿主解析），技能根通过 `baseUrl` 相对解析——整个预设完全可移植，无需任何网络安装步骤（`scripts/node_modules/mupdf` 已随包提交）。

## 技能与脚本

预设自带一个隔离技能 `course-logic-extract`（方法论唯一权威来源），脚本全部有单元测试护航：

| 脚本 | 用途 | 依赖 |
| --- | --- | --- |
| `pdfrender.mjs` | PDF → 高清页面图（渲染 + OCR 线路） | mupdf（**已随插件打包**，无需安装） |
| `dsocr2md.mjs` | 页面图/PDF → Markdown（GLM-OCR `layout_parsing`） | 智谱 API（见上） |
| `verify.mjs` | 转录质量对账（缺失页/空页/公式配对 → 质量报告） | 无 |
| `combine.mjs` | 直出合并归档（公式转 Obsidian 语法） | 无 |
| `stylevol/split.mjs` | 按章切分直出稿为分卷 | 无 |
| `stylevol/merge.mjs` | 分卷按序合并为成品 | 无 |
| `stylevol/check.mjs` | 分卷成品校验（一致性/结构/覆盖） | 无 |
| `mermaid2canvas.mjs` | 报告 mermaid 流程图 → Obsidian .canvas（`--index=N` 支持多图） | 无 |

## 卸载 / 更新

```sh
# 卸载插件
dsh plugin --profile web remove dsh-course-logic-extractor
# 插件卸载后预设目录仍在（它是自包含的），如需一并删除：
# 删除 ~/.dsh/.agent-presets/course-logic-extractor

# 更新插件后，插件自己安装过的预设副本会在下次启动时自动更新；
# 若预设目录是你自己编辑过的版本，插件不会覆盖。
```

## 目录结构

```
├── package.json        插件声明（dsh.bundle.patch）
├── cordis.patch.yml    宿主行挂载
├── lib/index.js        宿主半边：幂等落盘预设
└── preset/course-logic-extractor/
    ├── agent.cordis.yml   预设组合（agent-plane）
    ├── preset.yml         显示元数据
    └── skills/course-logic-extract/
        ├── SKILL.md       方法论（唯一权威）
        ├── USAGE.md       用户使用指南
        ├── styles.config.json  风格集配置（defaultStyle + styles）
        ├── styles/        排版风格样本（数学/工程/文科/论文）
        └── scripts/       配套脚本 + node_modules/mupdf（已打包）+ test/（单元测试）
```

## 交付目录约定（运行期产出，非仓库内容）

```
课程逻辑交付/<课程名>/
├── 0-规划/    自主找资料模式专属：能力点清单.md（树形，叶子带前置/后置/掌握标准）
│              · 能力点依赖图.canvas（必有）· 资料清单.md（七列，状态随落地更新）
├── 1-报告/    逻辑链分析.md（必有）· 学习路线图.md（默认）· <课程名>_参考风格优化版.md（可选）
│   └── 画布/  模块地图.canvas · 学习路线图.canvas 等全部流程图画布（必有）
├── 2-证据/    分块七要素/证据提取文件（有则归档）
└── 3-材料/    页面渲染/ · 逐页转录/ · 直出稿/ · 风格版分卷/ · 质量报告.md（仅资料经 OCR/转换时存在）
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
