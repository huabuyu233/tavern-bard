# CLI Agent 通用酒馆角色扮演 Skill（`tavern-bard`）设计文档

- **日期**：2026-11-25
- **范围**：跨 CLI Agent（Claude Code、Codex、Gemini CLI、Antigravity、Copilot CLI 等）通用酒馆角色扮演 Skill，部署于 `~/.agents/skills/tavern-bard/`

---

## 1. 背景与设计初衷（Intent & Why）

玩家希望在任意命令行 AI Agent 中直接游玩酒馆（SillyTavern 生态）角色卡，无需启动庞大的 Web 前端，并从零开始设计一套干净、契合强推理大模型与 CLI Agent 原生能力的方案。

核心洞察在于：**CLI Agent 与传统酒馆接的裸大模型 API 完全不同。**
- 传统酒馆里的大模型没有文件系统、没有工具、没有跨轮工作区，因此酒馆前端必须每轮在外部机械拼接角色卡、按关键词硬塞世界书、逼模型在正文末尾手写状态栏代码块、再用外部插件频繁重写滚动摘要。
- CLI Agent 天生拥有**文件读写/检索工具、工作目录持久化、以及自带的上下文管理与记忆系统**。一旦明确“**一个工作目录 = 一场角色扮演对话**”，我们只需在开局把五花八门的角色卡、世界书、预设一次性清洗转换为工作目录里的规范纯文本，后续游玩便能完全依靠 Agent 原生能力运转，把 Token 最大限度留给故事本身。

---

## 2. 目标、非目标与反目标（Goals, Non-Goals, Anti-Goals）

### 目标（Goals）
1. **任意 CLI Agent 通用**：不依赖特定 Agent 的私有插件或内部钩子；仅由标准 `SKILL.md`、`references/` 与零第三方依赖的原生 Node.js 辅助脚本组成。
2. **一目录一对局**：玩家确认在当前目录开始角色扮演后，当前工作目录即成为该对局的数据与记忆根目录，自动生成 `AGENTS.md`（及指向它的 `CLAUDE.md`），新开终端进入目录即可无缝续玩。
3. **素材统一纯文本化**：支持各类角色卡（V1/V2/V3 JSON、PNG 内嵌 `chara`/`ccv3` 块、DSH 等外层套壳 JSON）、卡内/独立世界书、SillyTavern 预设 JSON，初始化时统一拆解为工作目录内的 UTF-8 纯文本文件。
4. **状态栏自适应与双终端解耦**：
   - 无状态栏的卡片：不生成 `state.json`，单终端即可游玩；
   - 带状态栏的卡片（无论原生 MVU 卡还是传统前端正则/提示词状态栏卡）：统一转换为 `state.json` + `status/rules.md`，主终端只输出纯净文学正文，副终端运行 `hud.js` 实时渲染面板；
   - 对过于复杂或依赖前端 JS 运算的状态栏：允许舍弃部分难以稳定维护的字段以换取扮演稳定性，但**必须向玩家如实汇报转换结果与取舍原因**。
5. **预设原汁原味可控**：以预设 JSON 自身的开关状态为准（SillyTavern `prompt_order` 机制），编译出纯文本 `preset/active.md` 供 Agent 读取，并支持按条目查看、开启、关闭后重编译。
6. **低 Token 高保真双层记忆**：以 CLI Agent 自带上下文与记忆系统为主，`memory/`（`summary/` 摘要 + `full/` 完整全文）为辅；按场景切换或轮次阈值分层写入摘要，平时优先查摘要，需回溯细节时再检索全文。

### 第一版非目标（Non-Goals for v1）
- **不从 Agent 私有会话日志抓正文**：v1 采用所有 Agent 通用的显式写文件方式追加 `memory/full/`（从各家 Agent 本地日志自动提取正文留待后续优化）。
- **不运行前端网页或 JS 脚本**：自动剥离卡片中的 HTML/CSS 美化与 `tavern_helper` 前端脚本，不在终端模拟浏览器 DOM。
- **暂不内置扩展外围工具**：小说排版导出、多角色卡群聊轮换、外部物理骰子工具不在 v1 范围内。

### 反目标（Anti-Goals：哪怕技术上能跑也视为失败）
- **每轮用脚本重复拼装全量提示词塞给 Agent**：既浪费大量输入 Token，又破坏 Agent 自带的上下文缓存与记忆机制。
- **通过命令行参数传递大段小说正文**：如 ` script --reply "千字正文..."`，在 PowerShell / Bash 下极易因引号、换行、特殊字符崩坏。
- **主终端正文污染或出戏**：正文中绝不允许泄露状态栏代码块、`<mvu-status/>`、`<thinking>` / `<think_nya>` 等思维链标签、`<game>` / `<options>` / `<comment>` 等裸 XML 包装标签、JSON 片段或客服式出戏发言，也绝不允许替玩家扮演 `{{user}}` 的言行与心理。
- **静默吞掉状态栏或硬撑复杂状态栏导致崩盘**：不告知玩家就暗自丢弃状态栏，或强行维护数十个前端 JS 派生数值导致正文降智，均视为失败。
- **污染 Skill 安装目录**：任何对局运行期文件只能写入玩家当前工作目录，严禁写进 `~/.agents/skills/tavern-bard/`。

---

## 3. 约束条件（Constraints）

1. **安装位置与跨运行时发现**：
   - **源码仓库与运行包分离**：源码、自动化测试、`docs/` 与 `示例资源/` 保留在开发仓库 `d:\Users\huabu\project\skill\tavern-bard\`，仅将纯净运行包（`SKILL.md`、`scripts/`、`references/`）部署至 `~/.agents/skills/tavern-bard/`，避免测试与示例素材污染全局目录；
   - **清理旧版并统一多端入口**：部署时删除本机旧版 `tavern-bard`（移除 `~/.gemini/config/skills/tavern-bard` 旧联接及其指向的旧目录内容），主目录固定存放于 `~/.agents/skills/tavern-bard/`（Codex、Gemini CLI、Copilot CLI 直接识别），并建立 `~/.claude/skills/tavern-bard` 与 `~/.gemini/config/skills/tavern-bard` 指向 `~/.agents/skills/tavern-bard/` 的目录联接（Windows Junction / POSIX symlink），使 Claude Code、Codex、Gemini CLI、Antigravity、Copilot CLI 共享唯一真源且无同名触发冲突。
2. **脚本运行环境**：
   - Node.js v18+ 纯标准库（`node:fs`, `node:path`, `node:zlib`, `node:readline` 等），**零 `npm` 外部依赖**；
   - 兼容 Windows（PowerShell / cmd）与 macOS / Linux，调用一律显式使用 `node "<skill_dir>/scripts/xxx.js"`（避免打包器丢失可执行权限）。
3. **大体量文件耐受**：
   - 真实角色卡可达 9MB（内含 8MB+ `tavern_helper` 前端脚本、近百条世界书），真实预设可达 1.5MB（200+ 条目）。初始化脚本必须在毫秒级完成清洗与拆解，绝不让 Agent 直接用读文件工具硬啃原始大 JSON。

---

## 4. 架构方案比选（Approaches）

| 方案 | 做法简述 | 权衡与结论 |
| :--- | :--- | :--- |
| **A. 纯文档无脚本** | 只写 `SKILL.md`，让 Agent 直接用自带工具读原始角色卡 JSON / PNG 与预设 JSON | **淘汰**。无法直接解包 PNG 二进制块；遇到 3MB–9MB 角色卡或 1.4MB 预设会直接撑爆上下文，且在转义 JSON 字符串里做关键词检索极不可靠。 |
| **B. 一次导入纯文本化 + 原生零脚本游玩 + 可选副终端 HUD** | 开局跑一次 `init.js` 把卡片/世界书/预设拆成纯文本目录；游玩每轮 0 脚本调用，全靠 Agent 原生读写检索工具翻世界书、追加 `memory/full/`、写摘要、改 `state.json`；有状态栏时副终端跑 `hud.js` | **选定方案**。一次性解决脏格式与大文件问题；游玩时无命令行转义风险、无子进程延迟、已读设定自然留在上下文不重复烧 Token，完美契合“Agent 自带记忆为主、`memory/` 为辅”。 |
| **C. 每轮脚本编排全量上下文** | 每轮跑脚本匹配世界书、读取历史与状态并拼出整套提示词喂给 Agent，生成后再调脚本结算 | **淘汰**。与 Agent 自身的对话历史重复叠加，Token 消耗成倍膨胀，且命令行传正文在跨平台 Shell 下极脆弱。 |

---

## 5. 核心系统设计

### 5.1 已由玩家敲定的设计（User Decisions）
- **一目录一对局**：玩家明确表示开始角色扮演后，当前工作目录即为该场对话目录，统一存放转换后的角色卡、世界书、预设、记忆与状态。
- **双终端按需启用**：一个终端角色扮演，另一个终端显示 MVU 状态栏；**无状态栏的角色卡不启用状态栏与副终端**。
- **状态栏统一转 MVU + 坦诚降级**：前端状态栏一律转为 MVU（`state.json`）；若卡片状态栏过于复杂无法完美转换，向玩家说明困难之处，允许舍弃部分状态栏以换取扮演稳定性。
- **预设基于 JSON 开关加载**：预设本身是 JSON，依据 JSON 内的启用状态加载进对话，并提供清晰的条目开关控制。
- **双层辅助记忆机制**：以 Agent 自带记忆为主，工作目录 `memory/` 为辅；`memory/` 下仅设两个子目录——一个存故事摘要（`summary/`），一个存完整全文（`full/`）；优先读摘要，需要细节再查全文；写入时机参考成熟酒馆记忆方案（按场景边界 + 轮次阈值分层总结）。
- **v1 正文落盘策略**：先采用简单稳妥的通用方案（Agent 回复正文的同时用原生写文件工具将本轮对话追加到 `memory/full/`），先把项目跑通做好。
- **命名与旧版清理**：删除旧版 `tavern-bard`，新版继续使用 `tavern-bard` 名称并存放于 `~/.agents/skills/tavern-bard/`。
- **预设破限与文末附加项策略**：保留预设中的破限角色语境（如“小猫之神”等破限召唤外壳）；尊重原预设 JSON 默认开启的文末附加模块（如行动选项、文末留言/吐槽），不擅自默认关闭。

---

### 5.2 对局工作目录规范（Builder Proposal）

初始化完成后，当前工作目录结构如下：

```text
<当前对话工作目录>/
├── AGENTS.md                 # 供 Codex / Gemini / 通用 Agent 自动读取的对局恢复与规则入口
├── CLAUDE.md                 # 内容指向 @AGENTS.md，供 Claude Code 自动读取
├── campaign.json             # 对局元信息（角色名char、玩家名user、是否有状态栏hasStatus、当前轮次等）
├── card/
│   ├── character.md          # 清洗并完成宏替换后的角色核心设定（人设、性格、场景、示例对话、系统指令）
│   └── greetings/            # 开场白纯文本（greeting-01.md, greeting-02.md...，已剥离 HTML 外壳）
├── worldbook/                # 若无世界书则仅含空说明；有世界书则拆解如下：
│   ├── always.md             # 原卡常驻条目（蓝灯）：开局必读一次
│   ├── index.md              # 按需条目目录表（文件名 | 标题 | 原触发词 | 字数）：开局必读一次
│   ├── entries/              # 按需条目（绿灯）：每条一个纯文本 .md，剧情触及时按需翻阅
│   └── disabled/             # 原卡默认关闭的条目：平时不读，玩家要求开启时可移入 entries/ 或 always.md
├── preset/                   # 若玩家提供预设则生成，未提供则使用 Skill 内置轻量默认文风准则
│   ├── source.json           # 预设原始 JSON 副本（保留并直接读写其中的条目开关状态）
│   ├── overrides.json        # 【可选】极端非标预设条目的 Agent 语义清洗覆盖层
│   └── active.md             # 根据 source.json 当前开启条目（叠加 overrides.json）编译出的纯文本指令集
├── status/                   # 【仅当卡片存在状态栏时创建】
│   └── rules.md              # 状态字段含义、取值范围与每轮何时增减的纯文本规则
├── state.json                # 【仅当卡片存在状态栏时创建】MVU 实时状态数据，副终端 hud.js 监听此文件
└── memory/
    ├── summary/
    │   ├── facts.md          # 常驻核心事实表（人物关系、关键物品、未解伏笔/约定，控制上限约 150 行）
    │   ├── scenes.md         # 按时间追加的场景小总结（每条带章节/轮次编号，只追加不覆写）
    │   └── arcs.md           # 每攒满 5 条场景小总结，提炼合并追加一条阶段大总结
    └── full/
        ├── chapter-01.md     # 完整对话原文（按章节分卷，每卷约 20 轮，纯 Markdown 易读易 grep）
        └── chapter-02.md
```

> **安全护栏（Builder Call）**：在执行初始化前，若当前目录非空且不含 `campaign.json`（例如玩家误在代码项目根目录说“玩酒馆”），Agent 必须先向玩家确认是在当前目录直接初始化，还是新建一个子文件夹作为对局目录，绝不静默污染无关代码库。

---

### 5.3 初始化与五花八门素材的纯文本化流水线

初始化采用 **“确定性脚本拆解（`scripts/init.js`）+ Agent 语义级状态栏收尾”** 两步配合：

#### 第一步：`node "<skill_dir>/scripts/init.js"` 确定性清洗拆解
1. **多壳兼容解包**：
   - 若输入为 `.png`：解析 PNG `tEXt` / `iTXt` 数据块，优先读取 `ccv3`（Base64 JSON），回退读取 `chara`（Base64 JSON）；
   - 若输入为 `.json`：自动识别外层包装（如 `{ raw: { data: ... } }`、V2/V3 `{ data: ... }`、V1 顶层扁平对象）；
   - 支持额外传入独立世界书 `--worldbook <path>`（支持数组或对象形式的 `entries`）与预设 `--preset <path>`、玩家名 `--user <name>`（缺省询问玩家或用“旅人”）。
2. **宏替换与前端噪音剥离**：
   - 统一替换常见酒馆宏：`{{char}}` / `<BOT>` → 角色名，`{{user}}` / `<USER>` → 玩家名，`{{newline}}` → 换行，`{{trim}}` → 去除空白（保留不确定的双花括号原文以免误删叙事内容）；
   - 丢弃 `extensions.tavern_helper` 等前端脚本巨型字段；
   - 识别 `extensions.regex_scripts` 中用于将 `<start>...</start>` 等自定义包裹标签替换为 HTML 页面的规则，在导出 `greetings/` 与 `character.md` 时剥离纯装饰性 HTML/`<style>`/`<script>` 与外壳标签，保留里面的纯文学文本与正当的选项文本。
3. **世界书分类落盘**：
   - 遍历卡内 `character_book.entries` 与外部世界书：
     - **特例提取**：标题或内容含 `[initvar]` / `<initvar>`（即使 `enabled: false`，因为 MVU 规范中初值条目默认关闭）或 `[mvu_update]` 的条目，单独提取到 `status/_raw_candidates.md` 供状态栏转换，不混入普通世界书；
     - 其余 `enabled === false` 或 `disable === true` 的条目 → 写入 `worldbook/disabled/`（确保原作者标明“不建议开”的废弃状态栏或脏文风不会被误启用）；
     - `constant === true` 的启用条目 → 按 `insertion_order` 排序合并写入 `worldbook/always.md`；
     - 其余启用条目 → 每条写入 `worldbook/entries/<序号>-<安全标题>.md`，并生成 `worldbook/index.md` 目录表（处理原作者把多个关键词用中文逗号塞进单个字符串的常见写法）。
4. **状态栏候选探测**：
   - 脚本扫描三类来源并汇总至 `status/_raw_candidates.md`：
     1. **原生 MVU 结构**：`[initvar]` / `<initvar>` JSON、`[mvu_update]` 更新规则、`extensions.variables` / `dsh_mvu_conversion`；
     2. **前端提示词状态栏**：在启用中的 `character.md`、`always.md`、开场白或预设中，匹配要求模型“每次回复末尾生成状态栏 / 属性面板 / 时间栏”的段落及示例模板；
     3. **前端正则状态栏**：`extensions.regex_scripts` 中捕获特定文本块渲染状态面板的正则模式。
   - 同时剥离正文中残余的 `<mvu-status/>` 等纯前端占位符。

#### 第二步：Agent 语义审查、状态栏转 MVU 与向玩家汇报
脚本跑完后，Agent 检查 `status/_raw_candidates.md`：
- **情况 1：无任何状态栏候选**
  - 删除临时文件，标记 `campaign.json` 中 `hasStatus: false`；不创建 `state.json`，不提示开副终端，直接进入开场选定与演出。
- **情况 2：已是标准 MVU 卡**（如有现成 `<initvar>` JSON 与 `[mvu_update]`）
  - 将初值写入 `state.json`（保留层级结构，如 `世界`、`user`、各 NPC 对象）；
  - 将 `[mvu_update]` 中的酒馆专用工具名（如 `mvu_submit_update`）改写为“直接更新工作区 `state.json`”，存为 `status/rules.md`；删除候选临时文件。
- **情况 3：传统前端状态栏卡或超复杂混合状态栏卡**
  - Agent 阅读候选模板，提取有叙事意义的动态字段（如时间、地点、好感度、生命/理智、衣着、携带物品、当前心境），生成结构化初值 `state.json` 与简明更新规则 `status/rules.md`；
  - 将 `character.md` / `worldbook/always.md` / `preset/active.md` 中“要求在正文末尾手写状态栏代码块”的旧指令彻底移除，防止污染主终端正文；
  - **复杂度熔断与透明告知**：若原状态栏包含大量静态人体测量学常数（如发丝直径、跟腱长度等永不变化的数据）、依赖前端 JS 实时公式/随机脚本计算的字段、或每轮要求填写数十项琐碎器官描写导致严重拖慢与崩坏——
    - 静态常数留在角色档案 `worldbook/` 备查，不放进每轮刷新的 `state.json`；
    - 无法脱离前端 JS 稳定计算的字段果断舍弃；
    - **开局第一条回复前，用几行清晰自然语言向玩家汇报**：已转换哪些状态栏字段、省去了哪些复杂字段以及原因（玩家若想补回某个字段，一句话即可随时加入 `state.json`），并附上副终端启动命令：`node "<skill_dir>/scripts/hud.js"`。

---

### 5.4 预设（Preset）加载与开关控制设计

SillyTavern 预设 JSON 的真实结构包含两部分：
1. `prompts[]`：定义每个条目的 `identifier`、`name`、`role`、`content`、`marker`、`injection_position`、`injection_depth`；
2. `prompt_order[]`：定义条目的排列顺序与**实际生效的开关 `order[].enabled`**（SillyTavern 默认使用 `character_id: 100001` 组，若无则取最后一组或回退到 `prompts[].enabled`）。

**我们的处理机制（`scripts/preset.js`）**：
1. **原样落盘与读取**：初始化时把预设复制到 `preset/source.json`，直接以 `source.json` 内的 `prompt_order` 开关为唯一真源——玩家在酒馆里调好的预设拿过来开箱即用。
2. **保留破限语境、精准剥离伪工具干扰**：
   - 对于破限角色外壳条目（如 `召唤术` 的“小猫之神”对话包装），完整保留其破限对话与创作尺度设定，但编译时自动剥离其中伪造的工具调用指令（如 `soliumbra_reply`、“使用 `reply` 工具回复”）和内嵌思维链标签要求（如 `<think_nya>`），防止干扰 CLI Agent 原生工具调用。
3. **幂等纯文本编译清洗（`scripts/preset.js` 每次 `init` 与 `toggle` 均自动执行）**：
   - 剥离酒馆零 Token 注释宏 `{{// ... }}`；
   - 剥离前端插件宏指令（如 `<<<|catgodml|...>>>` 等 `SPreset` / `tavern_helper` 指令）；
   - 跳过 `marker: true` 插槽占位符（如 `Char Description`、`World Info`、`Chat History`），并自动过滤紧邻插槽前后仅含孤立开闭标签（如 `<{{user}}>`、`char`、`/char`）的残缺包裹碎片，以及纯装饰性分隔标题行（`content` 为空或只有 `===预设定===`、`----文风要求----` 这类分隔符的条目，编译时自动跳过不占 Token）；
   - **尊重文末附加项、净化 XML 外壳**：原预设开启的 `📏行动选项`、`📏猫猫留言~` 等文末模块保持启用，但自动去掉纯前端正则捕获用的 `<game>`、`<options>/<option>`、`<comment>` 等裸 XML 包裹要求，改写为干净的 Markdown 呈现规则。
4. **自动关闭的真正重复/冲突项（在 `source.json` 中置为关闭并在初始化报告中列出，可随时用 `toggle` 重开）**：
   - 强制裸露输出 `<thinking>` / `<think_nya>` 思维链标签的独立条目（CLI Agent 模型自带原生思考机制，裸打标签会弄脏小说屏幕）；
   - 要求在正文末尾手写状态栏代码块的条目（已由 `state.json` + `hud.js` 接管）；
   - 要求每轮在回复末尾输出 `<summary>` 场记小总结的条目（如 `📏小总结`，因已由本 Skill 的 `memory/summary/` 接管，避免每轮刷屏与双倍烧 Token）。
5. **可选语义修补覆盖层 `preset/overrides.json`（Builder Call）**：
   - 若初始化时遇到极端非标预设条目需 Agent 语义级微调清洗，修补结果写入 `preset/overrides.json`（按条目 `identifier` 映射清洗后文本）；
   - `preset.js toggle` 重编译 `active.md` 时始终叠加 `overrides.json`，保证玩家切换开关后不会把脏伪工具指令重新编译回来。
6. **编译为纯文本 `preset/active.md`**：
   - 将启用的常规条目按顺序合并为 `## 核心文风与扮演指令`；
   - 将 `injection_position === 1` 且 `injection_depth <= 2`（原酒馆插在最新对话附近的强约束指令）归入末尾 `## 每轮落笔前硬约束`，提醒 Agent 每轮遵守。
7. **命令行与自然语言开关管理**：
   - 查看全部条目开关：`node "<skill_dir>/scripts/preset.js" list`（输出序号、 `[x]`/`[ ]`、名称、字数）；
   - 开启/关闭指定条目并自动重编译 `active.md`：`node "<skill_dir>/scripts/preset.js" toggle --enable "<关键词或序号>" --disable "<关键词或序号>"`；
   - 游玩中玩家只需说“看看预设开了什么”或“把抗抢话打开”，Agent 调用该脚本并重读 `preset/active.md` 即可生效。

---

### 5.5 副终端状态栏看板（`scripts/hud.js`）

当对局包含 `state.json` 时，玩家在第二个终端（或终端分屏）对当前工作目录运行：
```bash
node "<skill_dir>/scripts/hud.js"
```
**设计要点**：
- **完全由角色卡决定字段（Schema-Free）**：支持扁平键值与多层嵌套对象（如《末路王朝》的 `世界`、`user`、各 NPC 分块），自动忽略 `$meta` 或 `_` 开头的内部元数据键；
- **智能视觉映射**：
  - 范围明确的数字/百分比（如 `好感度: 60`、`20/100`）→ ANSI 彩色进度条 + 数值；
  - 普通数字或带单位数值 → 高亮数值；
  - 短字符串数组 → 彩色胶囊标签 `[警惕] [寒冷]`；
  - 嵌套 `{ 状态, 详情 }` 或长句心声 → 紧凑两行卡片/引言样式；
- **变动差值高亮**：脚本在内存中保留上一次快照，通过 `fs.watch`（辅以轻量轮询防 Windows 文件锁漏事件）捕获更新后无闪烁重绘，并对本轮刚发生变化的字段标注醒目的增减提示（如 `(+5)`、`↑ 新变动`）；
- **随终端宽度自适应折行**，不溢出乱码。

---

### 5.6 记忆系统设计（Agent 自带记忆为主 + `memory/` 双目录为辅）

借鉴 **SillyTavern MemoryBooks**（场景边界切片 + 弧线合并）、**ST-Memory-Enhancement**（常驻核心事实表）与 **Letta/MemGPT**（核心常驻内存 vs 归档检索内存）：

#### 1. 两层协同定位
- **主记忆（In-Context）**：CLI Agent 当前会话窗口 + Agent 自带的上下文压缩与记忆文件机制（通过工作目录根目录自动生成的 `AGENTS.md` / `CLAUDE.md` 锚定身份、当前章节、核心禁忌与恢复指引）。
- **辅记忆（On-Disk `memory/`）**：防上下文压缩丢细节、防跨天重开终端失忆。严格只设两个子目录：
  - `memory/summary/`：`facts.md`（人物关系/关键道具/承诺伏笔，原地维护，严格控制在 150 行内）、`scenes.md`（场景小总结，只追加不重写，杜绝滚动摘要多次改写导致的失真）、`arcs.md`（大总结，只追加）。
  - `memory/full/`：`chapter-01.md`, `chapter-02.md`... 按章存储完整对话原文（包含轮次号、玩家行动与角色正文），既是永久聊天记录，也是全文检索库。

#### 2. 三个核心操作：写、读、何时触发

| 操作 | 写什么 / 读什么 | 触发时机（明确可观测条件） | Token 控制效果 |
| :--- | :--- | :--- | :--- |
| **每轮写全文** | 将本轮 `## Turn N`（玩家输入 + 角色回复正文）追加到当前 `memory/full/chapter-XX.md` | **每一轮演出结束时**（若玩家要求“重写上一轮”，则替换该文件末尾的最后一轮） | 只追加写入、**绝不回读整个章节文件** |
| **写小总结 & 更新事实表** | 1. 向 `memory/summary/scenes.md` 追加一段 100–200 字的场景摘要（注明对应章节与轮次范围 `chapter-02#Turn15-26`）；<br>2. 若有新人物登场、关系质变、获得/失去关键道具或立下约定，更新 `memory/summary/facts.md`；<br>3. 开启下一卷 `chapter-(XX+1).md` | 满足任一条件即触发：<br>① **场景自然切换**（地点转移、时间跨天/跳跃、或一段冲突告一段落）；<br>② **轮次兜底**：当前 `chapter-XX.md` 已满 **20 轮**未总结 | 平时每轮 0 总结开销；仅在换场或满 20 轮时写百余字 |
| **写大总结（弧线合并）** | 读取最近 5 条未合并的 `scenes.md` 条目，浓缩为一条 200–300 字阶段主线摘要追加到 `memory/summary/arcs.md` | 每当 `scenes.md` 新增满 **5 个场景** 时触发一次 | 超长篇（数百轮）时无需通读几十条小总结 |
| **读取记忆** | **开新会话/上下文刚被压缩后恢复时**，按固定预算只读：<br>1. `card/character.md`、`worldbook/always.md`、`worldbook/index.md`、`preset/active.md`（及 `state.json` + `status/rules.md` 若有）；<br>2. `memory/summary/facts.md` + `arcs.md` + `scenes.md` 最后 3 条；<br>3. 当前最新 `memory/full/chapter-XX.md` 的末尾最近 3–5 轮原文（接续语气）。<br>**盘中追忆细节时**：先看 `facts.md` / `scenes.md` 定位章节轮次，再用搜索工具（grep）或按行范围读取对应的 `memory/full/chapter-XX.md` 局部段落 | ① 新开 CLI 会话继续旧对局；<br>② 发现早期上下文已被 CLI 自动压缩；<br>③ 玩家提起久远往事、旧伏笔或具体台词细节，当前上下文中不确定时 | 无论玩到 30 轮还是 500 轮，开局恢复读取量恒定且极小；绝不整本通读 `memory/full/` |

---

### 5.7 单轮标准扮演闭环与硬性纪律（Roleplay Discipline）

每一轮玩家输入行动/对白后，Agent 遵循固定配方（Recipe）：

1. **按需查阅（平时跳过）**：
   - 若本轮涉及尚未加载进当前上下文的新人物、新地点或未知设定，从 `worldbook/index.md` 找到对应 `worldbook/entries/xxx.md` 读取；
   - 若玩家提及早已淡出上下文的旧事件细节，先查 `memory/summary/`，必要时局部检索 `memory/full/`。
2. **输出纯净文学正文**：
   - 严格遵循 `card/character.md` 与 `preset/active.md` 的人物性格、说话口吻与叙事文风；
   - **三条铁律**：
     1. **严禁出戏（Zero OOC）**：除非玩家主动跳出戏外发指令（如“改预设”“看看状态”“存档总结”），否则绝不用 AI 助手口吻说话；
     2. **严禁越界代演（Respect User Agency）**：绝不替 `{{user}}` 决定台词、心理活动或未声明的行动；
     3. **严禁正文污染（Clean Prose）**：主终端输出为故事正文，以及**原卡或当前启用预设明确要求的文末附加内容**（如行动选项、预设设定的文末留言/吐槽，统一用干净的纯 Markdown 分隔呈现，不输出 `<game>` / `<options>` / `<comment>` 等裸 XML 标签）；严禁在主终端输出状态栏代码块、`state.json` JSON、`<thinking>` / `<think_nya>` 思维链或 AI 助手客服套话。
3. **静默落盘结算**：
   - 将本轮玩家输入与刚生成的正文追加写入当前 `memory/full/chapter-XX.md`；
   - 若 `hasStatus: true`，依据本轮已发生的剧情事实与 `status/rules.md` 更新 `state.json`（副终端 HUD 即刻自动刷新）；
   - 若本轮触发“场景切换”或“当前章节满 20 轮”，顺手追加 `memory/summary/scenes.md`（及按需更新 `facts.md` / `arcs.md`）并开启新章节文件。

---

## 6. 留给实施阶段自行决定的细节（Left to the Builder）

以下工程细节不影响用户体验与核心行为，交由后续实施计划与编写阶段自行拍板：
1. **Skill 包文件拆分**：`SKILL.md` 控制在精悍易读篇幅内，将详细的状态栏转 MVU 指南与记忆摘要模板拆至 `references/`（遵循渐进式披露）。
2. **`scripts/` 内部命令行参数与模块化结构**：`init.js`、`preset.js`、`hud.js` 的具体 CLI 参数解析、PNG CRC/chunk 解析实现、文件名安全转义规则与 ANSI 配色主题。
3. **单元测试与 Skill TDD 压力测试设计**：Node 脚本使用 `node:test` 做自动化单元测试；`SKILL.md` 严格按照 `superpowers:writing-skills` 的 RED-GREEN-REFACTOR 流程，通过无 Skill 基线子 Agent 对照测试验证防出戏、防代答、防正文夹带状态栏、按规写记忆等行为。
