# dsh-course-logic-extractor

「课程逻辑提取器」agent 预设的 dsh 插件版：读取一门课程的资料（大纲、讲义、课件、字幕、习题等），还原这门课的设计逻辑——先教什么、后教什么、每个环节为什么放在那里，最终交付一条自洽的课程逻辑链。

安装后，预设 `course-logic-extractor` 会自动出现在 DSH 的预设选择器中，随插件分发到任何机器。

## 安装

```sh
dsh plugin --profile web add github:ShadowBruceMeaningLau/dsh-course-logic-extractor
```

重启 `dsh web`（或任何使用 agent presets 的界面）。新建会话时在预设选择器里选「课程逻辑提取器」即可。

## 工作原理

- 插件本体是一个极小的宿主半边：启动时把内置的预设目录（`preset/course-logic-extractor/`）幂等落盘到 DSH 的用户预设根 `~/.dsh/.agent-presets/`，预设选择器随即发现它。
- **不覆盖你的本地修改**：目标位置已存在**没有** `.dsh-plugin` 标记的预设（比如你自己写的版本）时，插件不碰它；只有插件自己装过的副本才会在版本升级时更新。
- 预设组合（`agent.cordis.yml`）引用官方 `@deepseek-ai/dsh-*` 包（由宿主解析），技能根通过 `baseUrl` 相对解析——整个预设完全可移植。

## 技能与依赖

预设自带一个隔离技能 `course-logic-extract`（方法论唯一权威来源），其中脚本：

| 脚本 | 用途 | 依赖 |
| --- | --- | --- |
| `pdfrender.mjs` | PDF → 高清页面图（渲染 + OCR 线路） | mupdf（**已随插件打包**，无需安装） |
| `dsocr2md.mjs` | 页面图 → Markdown（DeepSeek-OCR） | 硅基流动 SiliconFlow 托管的 `deepseek-ai/DeepSeek-OCR` |
| `combine.mjs` | 合并/归档产出 | 无 |

**OCR 密钥**（仅使用 OCR 功能时需要）：`SILICONFLOW_API_KEY` 环境变量或 `~/.dsh/free-vision.json`。免费申请：https://cloud.siliconflow.cn 。缺密钥时技能会明确提示用户补充，不影响其余功能（PDF 渲染、纯文本提取等）。

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
        ├── SKILL.md       方法论
        └── scripts/       配套脚本（mupdf 已打包在 node_modules 中）
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
