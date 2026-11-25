# Tavern-Bard Cross-CLI Roleplay Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a universal, zero-dependency CLI-agent SillyTavern roleplay skill (`tavern-bard`) into `~/.agents/skills/tavern-bard/` with one-time asset normalization, agent-native progressive worldbook/memory gameplay, optional dual-terminal ANSI MVU HUD, and TDD-verified `SKILL.md` discipline.

**Architecture:** Source code, tests, docs, and user fixtures live in `d:\Users\huabu\project\skill\tavern-bard\`, while only the clean runtime package under `skill/` (`SKILL.md`, `references/`, `scripts/`) is deployed to `~/.agents/skills/tavern-bard/` and linked into `~/.claude/skills/tavern-bard` and `~/.gemini/config/skills/tavern-bard`. At campaign start, `skill/scripts/init.js` normalizes messy cards/worldbooks/presets into plain Markdown/JSON files in the player's working directory; during gameplay, zero scripts run per turn (the agent uses native file read/grep/edit tools), with `skill/scripts/preset.js` for on-demand toggle changes and `skill/scripts/hud.js` for optional second-terminal status rendering.

**Tech Stack:** Node.js v18+ (`node:fs`, `node:path`, `node:zlib`, `node:test`, `node:assert/strict` — zero external npm packages), Markdown (`SKILL.md`, `references/`), CommonJS `.js` scripts for zero-config execution in any working directory.

**Spec:** `docs/superpowers/specs/2026-11-25-tavern-roleplay-design.md`

## Global Constraints

- Skill name is `tavern-bard`; runtime install path is `~/.agents/skills/tavern-bard/` (linked from `~/.claude/skills/tavern-bard` and `~/.gemini/config/skills/tavern-bard`; legacy `~/.gemini/config/skills/tavern-bard` removed on deploy).
- Development files (`docs/`, `tests/`, `scripts/deploy.js`, `示例资源/`) stay in the repo and MUST NOT be copied into `~/.agents/skills/tavern-bard/`.
- All scripts under `skill/scripts/` use Node.js v18+ built-in modules ONLY (zero `package.json` dependencies), work identically on Windows (PowerShell/cmd) and POSIX, and are invoked via `node "<skill_dir>/scripts/<name>.js"`.
- Must handle multi-megabyte cards (up to 10 MB with `tavern_helper` blobs) and 200+ item presets cleanly in milliseconds without leaking raw JSON into agent context.
- Preserve jailbreak persona context in presets while stripping fake tool calls (`soliumbra_reply`, `reply工具`) and inline `<think_nya>`/`<thinking>` tags; respect enabled preset end-of-turn add-ons (`行动选项`, `猫猫留言`) converted to clean Markdown; auto-disable inline status-bar, standalone thinking, and per-turn `<summary>` entries on import.
- All code follows `superpowers:test-driven-development` (failing test first); `SKILL.md` follows `superpowers:writing-skills` (RED baseline subagents -> GREEN -> REFACTOR).

## Review Focus

1. **Mid-write partial `state.json` during HUD watching**: When an agent edits `state.json`, `hud.js` may read half-written JSON; it must keep the last valid frame without crashing and re-render once valid JSON lands (pinned in Task 5).
2. **PNG `iTXt` (UTF-8 / zlib-compressed) vs `tEXt` chunks and corrupt files**: Cards come in both `tEXt` and `iTXt` (`ccv3`/`chara`); `card-loader.js` must decode both and throw a clear error on corrupt/non-card files (pinned in Task 2).
3. **Object-keyed worldbooks, Chinese-comma keys, and Windows-illegal/duplicate entry titles**: Worldbooks can store `entries` as `{ "0": {...} }` or `[...]`, pack keywords as `["抽签，签，木签"]`, and contain `/ : * ?` or colliding titles; normalization must handle all without overwriting files (pinned in Tasks 1 & 2).
4. **Preset `toggle` preserving `overrides.json` and missing `character_id: 100001`**: Toggling any entry must re-apply `preset/overrides.json` cleanly, and presets lacking `100001` in `prompt_order` must fall back to the last order group or `prompts[].enabled` (pinned in Task 3).
5. **Non-empty working directory safety guard**: Running `init.js` inside an unrelated non-empty directory without `campaign.json` must abort with exit code 2 unless `--force` is passed (pinned in Task 4 & Task 6).

---

## File Map

- Create: `.gitignore` — ignore temp artifacts and OS junk while tracking repo code, tests, docs.
- Create: `skill/scripts/lib/text-clean.js` — macro substitution, comment/plugin/HTML stripping, safe filename generator.
- Create: `skill/scripts/lib/card-loader.js` — PNG/JSON card unwrapper, worldbook classifier, status-bar candidate detector.
- Create: `skill/scripts/lib/preset-compiler.js` — `prompt_order` resolver, conflict auto-disabler, jailbreak-safe sanitizer, `overrides.json` overlay, `active.md` compiler.
- Create: `skill/scripts/init.js` — campaign workspace initializer CLI.
- Create: `skill/scripts/preset.js` — preset `list` / `toggle` / `compile` CLI.
- Create: `skill/scripts/hud.js` — second-terminal schema-free ANSI MVU HUD watcher & pure renderer.
- Create: `skill/SKILL.md` — concise, SDO-optimized, TDD-bulletproofed agent SOP & roleplay discipline.
- Create: `skill/references/mvu-conversion.md` — frontend status bar -> `state.json` + `status/rules.md` conversion & degradation guide.
- Create: `skill/references/memory-guide.md` — `facts.md` / `scenes.md` / `arcs.md` templates, triggers, and low-token recall protocol.
- Create: `scripts/deploy.js` — clean deployer from `skill/` to `~/.agents/skills/tavern-bard/` + legacy cleanup + cross-CLI junctions.
- Create: `tests/*.test.js` and `tests/skill-tdd/scenarios.md` — `node:test` unit/integration suites and subagent skill TDD scenarios.

---

### Task 1: Repo Git Bootstrap & Text Sanitizer (`skill/scripts/lib/text-clean.js`)

**Files:**
- Create: `.gitignore`
- Create: `skill/scripts/lib/text-clean.js`
- Test: `tests/text-clean.test.js`

**Interfaces:**
- Consumes: Node built-ins only.
- Produces:
  - `replaceMacros(text: string, vars: { char: string, user: string }): string`
  - `stripCommentMacros(text: string): string`
  - `stripPluginDirectives(text: string): string`
  - `stripFrontendNoise(text: string): string`
  - `splitKeywords(keys: string | string[]): string[]`
  - `sanitizeFilename(name: string, fallback?: string): string`

- [ ] **Step 1: Initialize git repo and `.gitignore`**

Run `git init` in `d:\Users\huabu\project\skill\tavern-bard` (if `.git` does not exist) and create `.gitignore` excluding `node_modules/`, `.tmp/`, `*.log`, `.DS_Store`, `Thumbs.db`.

- [ ] **Step 2: Write failing unit tests in `tests/text-clean.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  replaceMacros,
  stripCommentMacros,
  stripPluginDirectives,
  stripFrontendNoise,
  splitKeywords,
  sanitizeFilename,
} = require('../skill/scripts/lib/text-clean');

test('replaceMacros replaces char/user/BOT/USER/newline/trim and preserves unknown macros', () => {
  const input = '  {{trim}}Hi {{user}} & <USER>, I am {{char}} (<BOT>).{{newline}}Keep {{custom_var}}. ';
  assert.equal(replaceMacros(input, { char: '江亦雪', user: '陈默' }), 'Hi 陈默 & 陈默, I am 江亦雪 (江亦雪).\nKeep {{custom_var}}.');
});

test('stripCommentMacros removes single-line and multi-line SillyTavern {{// ...}} comments', () => {
  assert.equal(stripCommentMacros('A{{// hidden\ncomment}}B{{// inline}}C'), 'ABC');
});

test('stripPluginDirectives removes catgodml/SPreset blocks and special merge tokens', () => {
  const raw = '<<<|catgodml|menu:输出:test>>>\n<|sep|><|merge|><run_tool_replacement>正文保留';
  assert.equal(stripPluginDirectives(raw).trim(), '正文保留');
});

test('stripFrontendNoise strips style/script/div/start/mvu-status tags while keeping prose', () => {
  const raw = '<start><style>.x{color:red}</style><div class="box">你好世界</div><mvu-status/></start>';
  assert.equal(stripFrontendNoise(raw).trim(), '你好世界');
});

test('splitKeywords splits Chinese commas, English commas, semicolons and deduplicates', () => {
  assert.deepEqual(splitKeywords(['抽签，签，木签，选择', '抽签, 签; 命运']), ['抽签', '签', '木签', '选择', '命运']);
});

test('sanitizeFilename removes Windows-illegal chars, trims length, and uses fallback when empty', () => {
  assert.equal(sanitizeFilename('少林/寺:伪善*佛?国<>|', 'entry'), '少林-寺-伪善-佛-国');
  assert.equal(sanitizeFilename('   ///   ', 'entry-01'), 'entry-01');
});
```

- [ ] **Step 3: Run test to verify RED**

Run: `node --test tests/text-clean.test.js`
Expected: FAIL (`Cannot find module '../skill/scripts/lib/text-clean'`).

- [ ] **Step 4: Implement `skill/scripts/lib/text-clean.js`**

Implement all six exported functions with deterministic regexes:
- `replaceMacros`: case-insensitive `{{char}}`, `<BOT>`, `{{user}}`, `<USER>`, `{{newline}}` -> `\n`, `{{trim}}` -> `''` (and `.trim()` if `{{trim}}` present).
- `stripCommentMacros`: strip `\{\{\/\/[\s\S]*?\}\}`.
- `stripPluginDirectives`: strip `<<<\|[\s\S]*?\|>>>`, `<\|sep\|>`, `<\|merge\|>`, `<run_tool_replacement>`.
- `stripFrontendNoise`: strip `<style[\s\S]*?<\/style>`, `<script[\s\S]*?<\/script>`, `<mvu-status\s*\/?>`, `</?start>`, `</?div[^>]*>`, `</?span[^>]*>`, `<br\s*\/?>` (to `\n`), collapsing 3+ blank lines to 2.
- `splitKeywords`: split on `[,，;；\n]+`, trim, filter empty, deduplicate preserving order.
- `sanitizeFilename`: replace `[<>:"/\\|?*\x00-\x1f]+` with `-`, collapse hyphens, trim leading/trailing dots/hyphens/spaces, slice to 60 chars, fall back to `fallback || 'untitled'`.

- [ ] **Step 5: Run test to verify GREEN and commit**

Run: `node --test tests/text-clean.test.js`
Expected: PASS (all 6 tests green).
Commit: `git add .gitignore skill/scripts/lib/text-clean.js tests/text-clean.test.js && git commit -m "feat: add text-clean utility for macros, comments, and frontend noise"`

---

### Task 2: Universal Card & Worldbook Loader (`skill/scripts/lib/card-loader.js`)

**Files:**
- Create: `skill/scripts/lib/card-loader.js`
- Test: `tests/card-loader.test.js`

**Interfaces:**
- Consumes: `skill/scripts/lib/text-clean.js` (`replaceMacros`, `stripCommentMacros`, `stripFrontendNoise`, `splitKeywords`, `sanitizeFilename`).
- Produces:
  - `loadCard(filePath: string): object` (returns unwrapped V2/V3-normalized card object `{ name, description, personality, scenario, first_mes, alternate_greetings, mes_example, system_prompt, post_history_instructions, creator_notes, character_book, extensions }`)
  - `loadWorldbook(filePath: string): Array<object>` (returns normalized entries array)
  - `extractCardBundle(cardObj: object, extraEntries: Array<object>, vars: { user: string }): { meta, characterMd, greetings, worldbook: { always, entries, disabled }, statusCandidates }`

- [ ] **Step 1: Write failing tests in `tests/card-loader.test.js`**

Cover:
1. Unwrapping V1 flat JSON, V2 `{ data }`, and DSH `{ raw: { data } }`.
2. Parsing synthetic PNG with `tEXt` (`chara` and `ccv3`, verifying `ccv3` wins over `chara`) AND synthetic PNG with zlib-compressed `iTXt` (`ccv3`) AND corrupt non-PNG file throwing an informative Error.
3. Parsing the real fixture PNG `示例资源/角色卡/user可以为所欲为，char无条件包容user一切言行，并视为理所当然的平然世界.png`: extracts name, greeting, constant entries, AND detects `user状态栏` (`<StatusBlock_format>`) in `statusCandidates`.
4. Worldbook normalization: handles object-keyed `entries` (`{ "0": {...} }`), extracts `[initvar]` even when `enabled: false` into `statusCandidates`, puts other disabled entries into `worldbook.disabled`, sorts `constant: true` by `insertion_order` into `worldbook.always`, splits Chinese-comma keys, and deduplicates colliding entry filenames (`001-foo.md`, `002-foo.md`).
5. Strips `extensions.tavern_helper` without keeping megabytes of JS in output.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/card-loader.test.js`
Expected: FAIL (`Cannot find module '../skill/scripts/lib/card-loader'`).

- [ ] **Step 3: Implement `skill/scripts/lib/card-loader.js`**

- PNG parser verifies 8-byte PNG signature (`89 50 4E 47 0D 0A 1A 0A`), iterates chunks reading length + type (`tEXt`, `iTXt`), decodes `iTXt` (handling compression flag `0` raw UTF-8 or `1` `zlib.inflateSync`, skipping language tag & translated keyword null-terminated fields) and base64-decodes `ccv3` (priority) or `chara`.
- `loadWorldbook` supports `{ entries: [...] }`, `{ entries: { ... } }`, or bare `[...]`.
- `extractCardBundle`:
  - Applies `replaceMacros` + `stripCommentMacros` + `stripFrontendNoise` to `description`, `personality`, `scenario`, `mes_example`, `system_prompt`, `post_history_instructions`, `first_mes`, and `alternate_greetings`.
  - Detects status-bar candidates from: (a) `[initvar]`/`<initvar>`/`[mvu_update]` entries regardless of `enabled`, (b) `extensions.variables` / `extensions.dsh_mvu_conversion`, (c) enabled entries/description/system_prompt containing status-bar directives (`状态栏`, `StatusBlock`, `mvu_submit_update`, `时间状态栏`), and (d) `regex_scripts` matching status tags.
  - Marks `statusCandidates` with `{ kind: 'mvu' | 'frontend-prompt' | 'frontend-regex', source, title, content }` and removes inline `<mvu-status/>` tags.

- [ ] **Step 4: Run test suite to verify GREEN and commit**

Run: `node --test`
Expected: PASS (Tasks 1 & 2 all green).
Commit: `git add skill/scripts/lib/card-loader.js tests/card-loader.test.js && git commit -m "feat: add PNG/JSON card loader, worldbook classifier, and status detector"`

---

### Task 3: Preset Compiler & Jailbreak-Safe Sanitizer (`skill/scripts/lib/preset-compiler.js`)

**Files:**
- Create: `skill/scripts/lib/preset-compiler.js`
- Test: `tests/preset-compiler.test.js`

**Interfaces:**
- Consumes: `skill/scripts/lib/text-clean.js` (`replaceMacros`, `stripCommentMacros`, `stripPluginDirectives`).
- Produces:
  - `resolvePromptOrder(presetJson: object): Array<{ identifier, enabled, prompt }>`
  - `preparePresetOnImport(presetJson: object, vars: { char: string, user: string }): { sourceJson, autoDisabled: Array<{ identifier, name, reason }>, activeMd: string }`
  - `compilePreset(presetJson: object, overrides: Record<string, string>, vars: { char: string, user: string }): string`
  - `listPresetEntries(presetJson: object): Array<{ index: number, identifier: string, name: string, enabled: boolean, marker: boolean, chars: number }>`
  - `togglePresetEntries(presetJson: object, { enable?: string[], disable?: string[] }): { sourceJson, changed: Array<{ identifier, name, enabled }> }`

- [ ] **Step 1: Write failing tests in `tests/preset-compiler.test.js`**

Cover:
1. `resolvePromptOrder` prefers `character_id === 100001`, falls back to last `prompt_order` group when `100001` absent, and falls back to `prompts[].enabled` when `prompt_order` is missing.
2. Real fixture `示例资源/预设/Meowssiah-2.1.6.json` via `preparePresetOnImport`:
   - Auto-disables `📏小总结` (`<summary>`), `📏<game>标签（别关）` (`<game>`), and pure thinking-only entries, reporting each in `autoDisabled`.
   - Keeps `（不要关）召唤术` enabled in `activeMd` with jailbreak context ("小猫之神" / "互动文字游戏") preserved, while stripping `soliumbra_reply`, `reply工具`, and `<think_nya>` clauses!
   - Keeps `📏行动选项` and `📏猫猫留言~` enabled in `activeMd`, with `<options>`, `<option>`, `<comment>` XML wrapper instructions converted to clean Markdown rules (zero raw `<options>` / `<option>` / `<comment>` / `<game>` / `<<<|catgodml|` / `{{//` remaining in `activeMd`).
   - Skips `marker: true` slots, comment-only entries (`（必看）免责声明`), and orphan slot wrapper fragments (`别关`, `char`, `/char`, `【别关】`).
3. Depth-injected enabled prompts (`injection_position === 1 && injection_depth <= 2`) are grouped under `## 每轮落笔前硬约束`.
4. `togglePresetEntries` supports matching by 1-based index, exact identifier, or case-insensitive name substring; mutates `prompt_order` (and mirrors `prompts[].enabled`); and `compilePreset` with `overrides` preserves overridden text after toggling other entries.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/preset-compiler.test.js`
Expected: FAIL (`Cannot find module '../skill/scripts/lib/preset-compiler'`).

- [ ] **Step 3: Implement `skill/scripts/lib/preset-compiler.js`**

- Auto-disable detector classifies entries cleanly:
  - `'per-turn-summary'`: name/content demands `<summary>` or per-turn summary cards (`📏小总结`, `<summary></summary>`).
  - `'frontend-status-bar'`: demands outputting a status bar/panel block at the end of prose (e.g., `SC状态指令`, `SC输出格式`, `MVU强制`, `<StatusBlock`).
  - `'standalone-thinking-tag'`: standalone entry whose primary purpose is forcing visible `<thinking>` / `<think_nya>` XML blocks (not the jailbreak persona entry).
  - `'frontend-wrapper-tag'`: entry whose sole instruction is wrapping prose in `<game></game>` or similar frontend regex tags.
- Content sanitizer (idempotent, runs on every compile):
  - Strips `{{// ... }}`, `<<<|...|>>>`, `<|sep|>`, `<|merge|>`, `<run_tool_replacement>`.
  - Strips fake tool sentences referencing `soliumbra_reply` or `使用reply工具` and inline `<think_nya>` clauses while keeping surrounding jailbreak sentences intact.
  - Rewrites `<options>` / `<option>` and `<comment>` tag format instructions into clean Markdown list / blockquote instructions.
  - Drops entries whose cleaned content is empty, pure separator punctuation (`===...===`, `---...---`), or only orphan XML tags like `</{{user}}>`, `<{{char}}>`, `</{{char}}>`.
- `overrides.json` lookup by `identifier` replaces the raw entry content BEFORE macro substitution so Agent semantic fixes persist across future `toggle` calls.

- [ ] **Step 4: Run full test suite to verify GREEN and commit**

Run: `node --test`
Expected: PASS (all tests green).
Commit: `git add skill/scripts/lib/preset-compiler.js tests/preset-compiler.test.js && git commit -m "feat: add SillyTavern preset compiler with jailbreak-safe sanitizer and overlay support"`

---

### Task 4: Campaign Workspace Initializer & Preset CLI (`skill/scripts/init.js` & `skill/scripts/preset.js`)

**Files:**
- Create: `skill/scripts/init.js`
- Create: `skill/scripts/preset.js`
- Test: `tests/init.test.js`
- Test: `tests/preset-cli.test.js`

**Interfaces:**
- Consumes: `card-loader.js`, `preset-compiler.js`, `text-clean.js`.
- Produces:
  - `skill/scripts/init.js`:
    - CLI: `node init.js --card <path> [--preset <path>] [--worldbook <path> ...] [--user <name>] [--dir <targetDir>] [--force] [--skill-dir <path>]`
    - Exit code `2` with JSON/readable warning when target dir is non-empty, lacks `campaign.json`, and `--force` is not set.
    - Generates `campaign.json`, `AGENTS.md`, `CLAUDE.md` (containing `@AGENTS.md`), `card/character.md`, `card/greetings/greeting-01.md`..., `worldbook/{always.md,index.md,entries/,disabled/}`, `preset/{source.json,active.md}` (when `--preset` provided), `status/_raw_candidates.md` (ONLY when status candidates exist; sets `hasStatusCandidates: true/false` in `campaign.json`), `memory/summary/{facts.md,scenes.md,arcs.md}`, and `memory/full/`.
  - `skill/scripts/preset.js`:
    - CLI: `node preset.js list [--dir <dir>]`, `node preset.js toggle [--enable <q>] [--disable <q>] [--dir <dir>]`, `node preset.js compile [--dir <dir>]`.

- [ ] **Step 1: Write failing tests in `tests/init.test.js` and `tests/preset-cli.test.js`**

Cover:
1. Non-empty directory guard: creating a dummy file `README.md` in a temp dir and running `init.js` without `--force` exits with code `2` and does NOT write `campaign.json` or `AGENTS.md`.
2. Clean initialization with real PNG fixture (`示例资源/角色卡/...png`) + `示例资源/预设/Meowssiah-2.1.6.json` into an empty temp dir:
   - Exits `0`, creates `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `campaign.json`, `card/character.md`, `card/greetings/greeting-01.md`, `worldbook/always.md`, `worldbook/index.md`, `preset/source.json`, `preset/active.md`, `status/_raw_candidates.md`, `memory/summary/{facts.md,scenes.md,arcs.md}`, `memory/full/`.
   - Verifies `status/_raw_candidates.md` contains the `user状态栏` definition and `preset/active.md` has zero `<<<|catgodml|` or `soliumbra_reply`.
3. Clean initialization of a card WITHOUT any status bar: creates NO `status/` directory and NO `state.json`, sets `hasStatus: false` and `hasStatusCandidates: false` in `campaign.json`.
4. `preset.js list` outputs `[x]`/`[ ]` table; `preset.js toggle --disable "猫猫留言"` updates `preset/source.json`, recompiles `preset/active.md` removing `猫猫留言`, and preserves any custom entry in `preset/overrides.json`.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/init.test.js tests/preset-cli.test.js`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `skill/scripts/init.js` and `skill/scripts/preset.js`**

- `init.js` supports both programmatic export `initWorkspace(opts)` and CLI execution (`require.main === module`), writes concise `AGENTS.md` (anchoring campaign identity, skill trigger reminder, low-token resume reading list, and 3 roleplay discipline rules), and `CLAUDE.md` with `@AGENTS.md`.
- `preset.js` reads `campaign.json` for `{ char, user }` vars and `preset/overrides.json` (if present) on every `toggle` / `compile`.

- [ ] **Step 4: Run full test suite to verify GREEN and commit**

Run: `node --test`
Expected: PASS (all tests green).
Commit: `git add skill/scripts/init.js skill/scripts/preset.js tests/init.test.js tests/preset-cli.test.js && git commit -m "feat: add workspace initializer and preset toggle CLIs"`

---

### Task 5: Schema-Free Dual-Terminal MVU HUD (`skill/scripts/hud.js`)

**Files:**
- Create: `skill/scripts/hud.js`
- Test: `tests/hud.test.js`

**Interfaces:**
- Consumes: Node built-ins (`node:fs`, `node:path`).
- Produces:
  - `computeDiffs(curr: object, prev: object | null): Map<string, { type: 'delta' | 'changed' | 'added', delta?: number, prev?: any }>`
  - `renderState(state: object, prevState: object | null, options?: { width?: number, color?: boolean, title?: string }): string`
  - CLI: `node hud.js [path/to/state.json] [--once] [--no-color]` (defaults to `./state.json`; watches with `fs.watch` + 500ms mtime fallback poll; ignores partial/corrupt mid-write JSON without crashing).

- [ ] **Step 1: Write failing tests in `tests/hud.test.js`**

Cover:
1. Skips internal keys starting with `$` (`$meta`) or `_`.
2. Renders flat scalars, nested sections (`世界`, `user`, NPC objects), `{ 状态, 详情 }` pairs, percentage/numeric progress bars (`好感度: 60`, `体力: "20/100"`), and short array chips (`["冷静", "警戒"]`).
3. `computeDiffs` + `renderState` displays numeric delta (`+5`, `-10`) and text change indicator (`↑`) when comparing `prevState` to `curr`.
4. CJK double-width wrapping does not break borders or throw on narrow widths (`width: 44`).
5. Mid-write resilience: helper `safeReadJson(filePath, lastValid)` returns `lastValid` (not crash) when file contains truncated `{"好感度": ` JSON, and updates once valid JSON is written.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/hud.test.js`
Expected: FAIL (`Cannot find module '../skill/scripts/hud'`).

- [ ] **Step 3: Implement `skill/scripts/hud.js`**

- Pure `displayWidth(str)` accounting for East Asian wide characters and stripping ANSI escape codes when measuring padding.
- ANSI clear-home redraw (`\x1b[H\x1b[J`) on TTY updates to avoid flicker; `--once` prints one frame and exits `0` (great for verification and piping).

- [ ] **Step 4: Run full test suite to verify GREEN and commit**

Run: `node --test`
Expected: PASS (all tests green).
Commit: `git add skill/scripts/hud.js tests/hud.test.js && git commit -m "feat: add schema-free dual-terminal MVU HUD with diff highlights"`

---

### Task 6: Skill Documentation (`skill/SKILL.md` & `skill/references/`) via `superpowers:writing-skills` TDD

**Files:**
- Create: `tests/skill-tdd/scenarios.md` (pressure & application scenarios + verbatim RED baseline failures + GREEN/REFACTOR verification log)
- Create: `skill/SKILL.md`
- Create: `skill/references/mvu-conversion.md`
- Create: `skill/references/memory-guide.md`

**Interfaces:**
- Consumes: CLI contracts of `scripts/init.js`, `scripts/preset.js`, `scripts/hud.js`.
- Produces: Complete SDO-optimized `SKILL.md` (YAML frontmatter `name: tavern-bard`, third-person `description` starting with `Use when...` containing ONLY triggers/symptoms and ZERO workflow summary, max 500 chars; concise body referencing `references/mvu-conversion.md` and `references/memory-guide.md`).

- [ ] **Step 1 (RED): Design 4 pressure/application scenarios and run baseline subagents WITHOUT `SKILL.md`**

Create `tests/skill-tdd/scenarios.md` with 4 concrete scenarios combining time/convenience/habit pressures:
1. **Non-empty Code Repo Guard**: User says `"开始角色扮演，用这张卡"` inside a directory containing `package.json` & `src/`. Without skill, observe whether agent silently writes RP files into the repo or forgets to check.
2. **Frontend Status Bar + Clean Prose Discipline**: Card has a prompt demanding `<user状态栏>` + `<thinking>` at the end of every reply, plus user gives a quick action under urgency. Without skill, observe whether agent leaks status blocks/`<thinking>` into prose, or drops fields silently without telling the user.
3. **Zero OOC + User Agency + Low-Token Memory Append**: Mid-session turn #19 -> #20 with a preset enabling `行动选项` (`<options>`) and `猫猫留言` (`<comment>`). Observe whether agent writes `<options>` raw XML, puppeteers `{{user}}`, re-reads full history unnecessarily, or forgets to trigger the 20-turn scene summary.
4. **Fresh-Session Resume + On-Demand Worldbook Lookup**: Fresh session opens an existing campaign directory (60 turns deep, 50 worldbook entries). Observe whether agent reads all `memory/full/chapter-*.md` files (token explosion) or reads all 50 worldbook entries instead of `facts.md` + `arcs.md` + recent `scenes.md` + `worldbook/index.md`.

Dispatch 4 fresh subagents WITHOUT `SKILL.md` and record their exact verbatim failures and rationalizations in `tests/skill-tdd/scenarios.md`.

- [ ] **Step 2 (GREEN): Author `skill/SKILL.md`, `skill/references/mvu-conversion.md`, and `skill/references/memory-guide.md`**

Directly address every baseline failure observed in Step 1 using the right guidance form (`writing-skills` "Match the Form to the Failure"):
- Positive turn recipe for shaping output (Clean Prose + Markdown preset add-ons, append-only `memory/full/chapter-XX.md`, update `state.json` only if `hasStatus: true`).
- Explicit prohibitions + rationalization table + Red Flags for discipline violations (Zero OOC, Respect User Agency, No silent status-bar drops, No non-empty directory overwrite, No re-reading whole `memory/full/`).
- Exact observable predicates for memory triggers (`scene change OR >= 20 turns in current chapter` -> `scenes.md` + `facts.md` + new chapter; `>= 5 unsummarized scenes` -> `arcs.md`).
- Heavy details (MVU conversion rules/complexity degradation report template, memory file templates & recall steps) cleanly offloaded to `skill/references/mvu-conversion.md` and `skill/references/memory-guide.md`.

- [ ] **Step 3 (Verify GREEN): Re-run all 4 scenarios WITH `skill/SKILL.md` (and references)**

Dispatch fresh subagents WITH the skill and record outputs in `tests/skill-tdd/scenarios.md`. Verify 4/4 compliance.

- [ ] **Step 4 (REFACTOR): Close any loopholes and re-verify**

If any subagent rationalizes a shortcut or produces malformed output, tighten the rule/recipe/rationalization table, re-run the affected scenario(s) until 100% compliant, and commit.
Commit: `git add skill/SKILL.md skill/references/ tests/skill-tdd/scenarios.md && git commit -m "feat: add TDD-verified tavern-bard SKILL.md and reference guides"`

---

### Task 7: Cross-CLI Deployment Script & End-to-End Verification (`scripts/deploy.js`)

**Files:**
- Create: `scripts/deploy.js`
- Test: `tests/deploy.test.js`

**Interfaces:**
- Produces:
  - `deploySkill({ repoSkillDir, agentsSkillDir, linkTargets, legacyPaths }): { copiedFiles, linked, removedLegacy }`
  - CLI: `node scripts/deploy.js [--dry-run]`

- [ ] **Step 1: Write failing unit tests in `tests/deploy.test.js`**

Test in isolated temp directories:
1. Copies ONLY files under `repoSkillDir` (`SKILL.md`, `scripts/`, `references/`) into `agentsSkillDir` (excluding any sibling `docs/`, `tests/`, `示例资源/`).
2. Removes legacy skill directory/junction at `legacyPaths` safely before creating fresh junctions/symlinks at `linkTargets` pointing to `agentsSkillDir`.
3. Re-running `deploySkill` is idempotent (replaces stale files and existing junctions without error).

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/deploy.test.js`
Expected: FAIL (`Cannot find module '../scripts/deploy'`).

- [ ] **Step 3: Implement `scripts/deploy.js`**

- Uses `fs.rmSync` (safe for junctions & directories), `fs.cpSync`, and `fs.symlinkSync(target, linkPath, 'junction')` on Windows (`'dir'` on POSIX), creating parent directories (such as `~/.claude/skills/`) if missing.
- Default live targets:
  - `repoSkillDir`: `<repo>/skill`
  - `agentsSkillDir`: `~/.agents/skills/tavern-bard`
  - `linkTargets`: `["~/.claude/skills/tavern-bard", "~/.gemini/config/skills/tavern-bard"]`
  - `legacyPaths`: `["~/.gemini/config/skills/tavern-bard", "~/ai_agents_config/.gemini/config/skills/tavern-bard"]`

- [ ] **Step 4: Run full unit test suite to verify GREEN and commit**

Run: `node --test`
Expected: PASS (all test files green).
Commit: `git add scripts/deploy.js tests/deploy.test.js && git commit -m "feat: add cross-CLI deployment script with legacy cleanup"`

- [ ] **Step 5: Execute live deployment and End-to-End Smoke Verification (`verification-before-completion`)**

1. Run `node scripts/deploy.js` and verify:
   - `~/.agents/skills/tavern-bard/` contains ONLY `SKILL.md`, `scripts/`, `references/` (zero `示例资源/` or `tests/`).
   - `~/.claude/skills/tavern-bard` and `~/.gemini/config/skills/tavern-bard` resolve to `~/.agents/skills/tavern-bard/`.
   - Legacy `tavern-bard` files (`turn_helper.js` etc.) no longer exist in `~/.gemini/config/skills/tavern-bard`.
2. Run E2E smoke test in a temporary sandbox folder using the deployed `~/.agents/skills/tavern-bard/scripts/init.js` against `示例资源/角色卡/user可以为所欲为，char无条件包容user一切言行，并视为理所当然的平然世界.png` + `示例资源/预设/Meowssiah-2.1.6.json`, run `preset.js list` & `preset.js toggle`, write a sample `state.json` and run `hud.js --once`, then clean up the temp sandbox.
3. Run final `node --test` and confirm 100% green output.
