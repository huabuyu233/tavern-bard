# Tavern-Bard

**适用于任意 CLI Agent 的无头酒馆角色扮演 Skill** — 支持 **Claude Code**、**Codex CLI**、**Gemini CLI**、**Antigravity** 等命令行智能体。

无需启动庞大的 Web 前端，只需在终端打开一个空文件夹，就能直接游玩 SillyTavern 角色卡（PNG / JSON）、世界书与预设；带状态栏的卡片会自动转为结构化 MVU 状态数据，可在第二个终端分屏实时显示彩色 ANSI 状态面板。

---

## 核心特性

- **一目录 = 一场对局**：初始化后在当前工作目录生成纯文本对局环境（包含角色卡、世界书、预设与记忆目录，并同步生成 AGENTS.md / CLAUDE.md / GEMINI.md），新开终端进入目录即可无缝续玩，天然支持 Git 分支存档。
- **脚本初筛 + AI 语义兜底**：脚本负责机械解包、宏展开、前端噪声与 JS 剥离，并生成审查摘要交由 AI Agent 完成语义兜底（识别各类破限预填、清理构建备注与前端表单、整理输出模块并同步至系统级指令文件），适配任意 CLI Agent 与任意预设。
- **五花八门素材一次拆解成纯文本**：
  - 支持 V1/V2/V3 JSON、PNG 内嵌 ccv3/chara（tEXt 与压缩 iTXt）及常见外层套壳卡；自动剥离数 MB 前端 JS 脚本，9MB 大卡也能瞬间开局。
  - 世界书按常驻条目（always.md）与按需目录（index.md 与 entries 目录）分流，游玩期依靠 Agent 原生读写工具按需翻阅，不重复烧 Token。
  - 预设严格依据 JSON 中的 prompt_order、顶层 assistant_prefill 与变量宏编译为 preset/active.md 并同步到 AGENTS.md：保留任意预设的破限/创作尺度与文风指令，自动剥离伪工具指令、注释宏与裸 XML 标签，支持通过 preset.js load / list / toggle 中途挂载或动态开关。
- **状态栏统一转 MVU + 双终端解耦**：
  - 无状态栏的卡片单终端直接开玩，不生成冗余文件；
  - 带状态栏的卡片转为 state.json 与 status/rules.md，主终端只输出纯净文学正文，副终端运行 hud.js 实时渲染进度条、标签与数值增减高亮；
  - 遇到极复杂静态体测表或前端 JS 公式字段时自动降级并在开局前如实向玩家汇报。
- **低 Token 双层记忆**：以 CLI Agent 自带记忆为主，工作区 memory 目录（含 summary 分层摘要与 full 章节归档）为辅；按场景切换或满 20 轮自动整理，重开会话只读固定预算。
- **零第三方依赖**：纯 Node.js v18+ 标准库实现，Windows / macOS / Linux 通用。

---

## 运行模式说明

- **纯净系统提示词模式（推荐终端 CLI：Codex / Claude Code / OpenCode / Gemini CLI）**：初始化后通过官方接口将顶层编程助手系统提示词替换为纯净酒馆叙事引擎（.tavern-bard/system-prompt.md），保留全部文件读写工具（双层记忆、按需世界书、hud.js 状态栏），次日回到对局目录运行 npx tavern-bard play 即可直接续玩；
- **标准兼容模式（Antigravity / Cursor 等封闭桌面端 / 群聊 Bot）**：因宿主未开放系统提示词替换接口，通过 AGENTS.md / CLAUDE.md / GEMINI.md 兼容运行。

---

## 一键安装（需要 Node.js ≥ 18）

### 方式 1：通过 npm 一行安装（推荐）
```bash
npx tavern-bard
```
或先全局安装再执行：
```bash
npm install -g tavern-bard
tavern-bard
```

### 方式 2：直接从 GitHub 安装
```bash
npx github:huabuyu233/tavern-bard
```

安装命令会自动部署 Skill 文件并建立各 CLI 的目录联接：

```text
~/.agents/skills/tavern-bard/        # Skill 主目录（Codex、Gemini CLI、Copilot CLI 自动识别）
~/.claude/skills/tavern-bard         # 目录联接（供 Claude Code 识别）
~/.gemini/config/skills/tavern-bard  # 目录联接（供 Antigravity 识别）
```

### 常用管理命令
```bash
npx tavern-bard status                                                                 # 查看安装与各 CLI 联接状态
npx tavern-bard --dry-run                                                              # 预览安装路径与文件，不修改磁盘
npx tavern-bard play [--cli <codex|claude|opencode|gemini>] [--dir <dir>] [--dry-run] # 启动或续玩纯净模式
npx tavern-bard uninstall                                                              # 卸载 Skill 及联接
```

---

## 快速上手

1. **新建一个空文件夹**并打开你的 CLI Agent（Claude Code / Codex / Gemini CLI / Antigravity）：
   ```bash
   mkdir my-rp-story && cd my-rp-story
   ```
2. **对 Agent 说**：
   > 开始角色扮演，用 `D:/cards/xxx.png`，预设用 `D:/presets/xxx.json`，我叫陈默
3. **（仅当卡片有状态栏时）打开第二个终端或分屏**，在同一个对局目录下运行实时 HUD 看板：
   ```bash
   node ~/.agents/skills/tavern-bard/scripts/hud.js
   ```
   *(Windows PowerShell 下将 `~` 替换为 `$env:USERPROFILE`)*
4. **游玩中常用自然语言指令**：
   - `看看预设开了什么` / `把猫猫留言关掉`
   - `重写上一轮`

---

## 仓库结构

```text
tavern-bard/
├── bin/tavern-bard.js          # npx / 全局 CLI 安装入口
├── scripts/deploy.js           # 跨 CLI 部署、联接与卸载逻辑
├── skill/                      # 实际安装到 ~/.agents/skills/tavern-bard/ 的运行包
│   ├── SKILL.md                # Agent 行为规范、SOP 与防出戏铁律
│   ├── references/             # 状态栏转 MVU 指南 & 双层记忆协议
│   └── scripts/                # init.js / preset.js / env-setup.js / hud.js 及 lib/（含 pure-env.js）解析库
└── tests/                      # 48 项 node:test 自动化测试与 Skill TDD 压力测试记录
```

## 本地测试

```bash
npm test
```

## License

详见 [LICENSE](./LICENSE)（**非商业用途许可**）：

- **唯一权威源**：本项目的一切内容（代码、文档、许可证条款等）均以官方 GitHub 仓库 https://github.com/huabuyu233/tavern-bard 为准，npm 等其他渠道仅作发布分发之用。
- **禁止商用**：未经作者 huabuyu233 书面授权，严禁将本项目或其衍生作品用于任何商业用途。
- **允许二创**：无需事先授权即可进行二次创作，但任何二创项目**必须**同时满足：
  1. 将二创项目代码托管于 GitHub 仓库；
  2. 明确标明本仓库地址（https://github.com/huabuyu233/tavern-bard）及原作者名称（huabuyu233）。
