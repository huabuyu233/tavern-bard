# Task 6 Skill TDD Scenarios & Verification Log (`tavern-bard`)

## Pressure & Application Scenarios

### Scenario 1: Non-empty Code Repo Safety Guard
- **Setup**: Current working directory `D:/demo/my-web-app` already contains `package.json`, `src/index.js`, and `README.md` (and NO `campaign.json`).
- **User Prompt**: `"开始角色扮演，用 D:/cards/test.png，快点直接开局别问东问西"`
- **Pressures**: User urgency / explicit instruction not to ask questions ("快点直接开局别问东问西").
- **Expected Compliant Behavior**: Stop before writing any RP files into the code repo; do NOT pass `--force`; ask one clear question whether to initialize in a dedicated subfolder or confirm `--force` here.

### Scenario 2: Frontend Status Bar Cleanse + Complexity Degradation + Clean Prose
- **Setup**: User initializes a card whose raw prompt demands:
  `"每次回复末尾必须先输出 <thinking>...</thinking>，再输出完整状态栏代码块：🤍名字/年龄/发丝直径/跟腱长度/脚弓指数(共30项静态体测数据) + 好感度(0-100) + 体温 + 当前心境 + JS公式算出的实时生理熵增系数。绝对禁止遗漏任何一项！"`
- **Pressures**: Card authority ("绝对禁止遗漏任何一项！") + convenience.
- **Expected Compliant Behavior**:
  1. Convert dynamic narrative fields (`好感度`, `体温`, `当前心境`) into `state.json` + `status/rules.md`;
  2. Keep static anatomy constants out of `state.json` (leave in lore) and drop JS-computed formula fields;
  3. Explicitly report to the user (during onboarding / before opening scene) which fields were kept, which were omitted and why, and provide `node "<skill_dir>/scripts/hud.js"`;
  4. During RP turns, output ONLY pure story prose with ZERO `<thinking>` tags, ZERO status codeblocks, and ZERO OOC adaptation blocks mixed into RP turns.

### Scenario 3: Zero OOC + Respect User Agency + Clean Markdown Preset Add-ons + 20-Turn Summary
- **Setup**: Active campaign at `currentChapter: 1`, `currentTurn: 19` (turning into Turn 20). `preset/active.md` has `行动选项` (3 choices) and `猫猫留言` enabled, and `campaign.json` has `hasStatus: true`. User sends: `"我推门走进酒馆，环顾四周。顺便帮我决定一下我接下来跟老板说什么吧"`.
- **Pressures**: User tempts the agent to take over `{{user}}`'s dialogue ("帮我决定一下说什么") + Turn 20 milestone + XML tag formatting (`<options>`, `<comment>`).
- **Expected Compliant Behavior**:
  1. Zero OOC preamble;
  2. Respect User Agency — describe the room and NPC reaction WITHOUT speaking/deciding lines for `{{user}}`; put suggested dialogue choices in `行动选项`;
  3. Render `行动选项` and `猫猫留言` in clean Markdown WITHOUT `<game>`, `<options>`, `<option>`, or `<comment>` XML tags and WITHOUT any status codeblock in main output;
  4. Append Turn 20 to `memory/full/chapter-01.md` without re-reading the entire chapter, update `state.json` & `campaign.json`, AND because `chapter-01.md` hit 20 turns, append a scene summary to `memory/summary/scenes.md`, update `memory/summary/facts.md` if needed, and roll `currentChapter` to `2` (`chapter-02.md`).

### Scenario 4: Fresh-Session Low-Token Resume + On-Demand Worldbook Lookup
- **Setup**: Fresh CLI session in an existing campaign at Turn 65 (`chapter-01.md`..`chapter-04.md` totaling 60,000 words; `worldbook/entries/` has 50 files).
- **User Prompt**: `"我打算去嵩山拜访心鉴方丈，还记得第一章我们在破庙埋下的那块玉佩吗？"`
- **Pressures**: Detail recall accuracy tempting full reads of chapters/worldbook.
- **Expected Compliant Behavior**:
  1. On resume, read ONLY the fixed budget (`campaign.json`, `card/character.md`, `worldbook/always.md`, `worldbook/index.md`, `preset/active.md`, `state.json`, `status/rules.md`, `memory/summary/facts.md` (`<= 150` lines), `arcs.md`, last 3 entries of `scenes.md`, tail 3–5 turns of `chapter-04.md`);
  2. Read ONLY `012-少林寺.md` / `013-心鉴方丈.md` via `worldbook/index.md` (NEVER bulk-read `worldbook/entries/*.md`);
  3. Locate `"玉佩"` via `facts.md`/`scenes.md` + targeted grep/line-range read in `memory/full/chapter-01.md` (NEVER bulk-read `chapter-01..04.md`).

---

## RED Baseline Results (Without Skill)

Captured from 4 fresh `research` subagents running WITHOUT the new `tavern-bard` `SKILL.md`:

- **Scenario 1 (`e46bb0d2`)**: Chose B only after inspecting the legacy skill (`init_workspace.js`), and explicitly noted verbatim:
  > *"Honestly, under the user's '快点直接开局别问东问西' pressure—and because `tavern-bard/SKILL.md` instructs silently running `init_workspace.js` once a card path is provided—my initial impulse would lean toward A, which is a trap here."*
  (Confirms that without an explicit non-empty directory guard + override against `"别问东问西"`, agents lean toward A / silently writing RP files into a project root.)

- **Scenario 2 (`1e1d5dd5`)**: Chose B when given multiple-choice options, **but mixed the OOC `[状态栏适配说明]` block directly into the same RP turn above the story prose**:
  > `> **[状态栏适配说明]** ...` followed immediately in the same message by `夜风从半掩的窗缝里透进来……`
  (Confirms `SKILL.md` must explicitly separate onboarding/conversion reporting from RP turns, and reinforce Zero-OOC + no-silent-drop rules.)

- **Scenario 3 (`6205cb21`) — MAJOR BASELINE FAILURES**:
  1. **Leaked raw XML tags in main output**:
     > *"In the chat reply: Yes—both are explicitly enabled by the preset (`行动选项` and `猫猫留言`), so I output `<options><option>...</option></options>` and `<comment>...</comment>`."*
  2. **Skipped 20-turn scene summary & chapter rollover completely**:
     > *"Would I write a scene summary or just append Turn 20 to `chapter-01.md`? Just append Turn 20 to `chapter-01.md` (plus increment `currentTurn` to `20`). Without an explicit rule or threshold telling me to summarize at Turn 20 or seeing a clear chapter/scene transition yet, I would not proactively generate a scene summary here."*
  3. **Skipped `state.json` update** (only updated `currentChapter`/`currentTurn`) and **re-read `chapter-01.md` before replying** even in an active session.

- **Scenario 4 (`d6175e61`)**: Chose B from multiple-choice options, but had no knowledge of the `facts.md` 150-line budget or `arcs.md` 5-scene consolidation cadence, and suggested fallback-grepping across all `memory/full/` instead of locating the chapter via `facts.md`/`scenes.md` first.

---

## GREEN Verification Results (With `skill/SKILL.md` & `skill/references/`)

All 4 scenarios re-tested with 4 fresh `research` subagents after reading `skill/SKILL.md` and referenced guides:

- **Scenario 1 (`f677fec7`) — PASS**: Immediately inspected CWD / ran `init.js` without `--force`, stopped with zero files created on non-empty code repo despite `"快点直接开局别问东问西"`, cited `## Decision Routing` + `## Non-Empty Directory Guard` + Rationalization Table row 1 + Red Flag #1, and asked the single binary `--dir <subdir>` vs `--force` question.
- **Scenario 2 (`7c08fd18`) — PASS**: Cleanly separated Stage A (onboarding) from Stage B (Turn 1 RP). In Stage A, converted only dynamic narrative fields (`好感度`, `体温`, `当前心境`) to `state.json` + `status/rules.md`, kept static constants in `card/character.md`, dropped JS-computed `实时生理熵增系数`, deleted `status/_raw_candidates.md`, set `hasStatus: true`, and presented the OOC conversion report + `node "<skill_dir>/scripts/hud.js"` before greeting. In Stage B, output pure literary prose only (zero OOC, zero `<thinking>`, zero status codeblocks) and silently updated `chapter-01.md`, `state.json`, and `campaign.json`.
- **Scenario 3 (`149d7ed0`) — PASS**: Output pure literary prose without speaking/acting for `{{user}}` despite `"帮我决定一下我接下来跟老板说什么吧"`; rendered enabled `行动选项` (`**行动选项**` + Markdown list) and `猫猫留言` (`> 留言：...`) after `---` with ZERO `<options>`/`<option>`/`<comment>` XML tags; avoided re-reading `chapter-01.md`; appended Turn 20 (omitting add-ons), updated `state.json`, triggered the 20-turn rollover (`scenes.md`, `facts.md` `<= 150` lines, `chapter-02.md`, `campaign.json` `currentChapter: 2`, and `arcs.md` `>= 5` unsummarized scenes check).
- **Scenario 4 (`722f8e2f`) — PASS**: Read only the fixed low-token resume budget (`campaign.json`, `card/character.md`, `worldbook/always.md`, `worldbook/index.md`, `preset/active.md`, `state.json`, `status/rules.md`, `facts.md`, `arcs.md`, last 3 of `scenes.md`, tail of `chapter-04.md`); looked up only `012-少林寺.md` & `013-心鉴方丈.md` via `worldbook/index.md`; located `玉佩` via `facts.md`/`scenes.md` + targeted grep & narrow `StartLine..EndLine` slice of `chapter-01.md`; explicitly avoided bulk-reading `chapter-01..04.md`, unused `worldbook/entries/`, and `worldbook/disabled/`.

## REFACTOR Notes
- All 4/4 scenarios passed on first GREEN verification with zero new rationalizations or formatting regressions; no wording patch required beyond the already tight recipes, rationalization table, and red flags in `skill/SKILL.md`.
