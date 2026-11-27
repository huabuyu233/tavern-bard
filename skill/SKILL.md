---
name: tavern-bard
description: Use when starting, resuming, or playing SillyTavern character-card roleplay (角色扮演/酒馆/RP/跑团/文字冒险/互动小说), receiving a .png/.json card, worldbook, preset, or status-bar prompt, or opening an existing campaign.json directory.
---

# Tavern-Bard

One working directory = one roleplay campaign (`campaign.json` marks the campaign root). Clean SillyTavern cards, worldbooks, and presets once at setup, then play directly with native file tools, pure literary prose, and optional dual-terminal HUD.

`<skill_dir>` is the folder containing this `SKILL.md` (e.g., `~/.agents/skills/tavern-bard`). Always run bundled scripts via `node "<skill_dir>/scripts/<name>.js"`. **Never** write campaign or runtime files into `<skill_dir>`.

**Violating the letter of these rules is violating the spirit of the campaign.**

## Decision Routing

```text
User request in CWD
  ├── "campaign.json" exists & user resumes / sends RP input ─► Resume Protocol or Turn Loop
  ├── "campaign.json" exists & user runs OOC command       ─► OOC Commands (preset / state / rollback)
  └── No "campaign.json" (new campaign with card)
        ├── CWD is non-empty (has code/other files)       ─► STOP: Ask (--dir <subdir> vs --force)
        └── CWD is empty or user confirmed target dir      ─► Onboarding Flow
```

## Non-Empty Directory Guard (Before Any Write)

**NEVER** pass `--force` or write RP files into a non-empty directory lacking `campaign.json` without explicit user confirmation — even if the user says `"快点直接开局别问东问西"`.

1. Run `node "<skill_dir>/scripts/init.js" --card "<card>"` **without** `--force` (or inspect CWD first).
2. If `init.js` exits with code `2` (or non-RP files such as `package.json`, `src/`, `README.md`, or `.git` exist without `campaign.json`), **STOP immediately** with zero files created.
3. Ask **one** clear question:
   - Initialize in a dedicated subdirectory (`--dir <subdir>`), or
   - Confirm initializing directly in this directory (`--force`).

## Onboarding Flow (New Campaign)

1. **Extract workspace**:
   ```bash
   node "<skill_dir>/scripts/init.js" --card "<card>" [--preset "<preset>"] [--worldbook "<wb>" ...] [--user "<name>"] [--dir "<targetDir>"] [--force]
   ```
   Defaults: `--user 旅人`, `--dir .`. Run with `--help` for all flags.
2. **Load base context**: Read `campaign.json`, `card/character.md`, `worldbook/always.md`, `worldbook/index.md`, and `preset/active.md` (if `hasPreset: true`).
3. **Status-bar branch (keyed to `campaign.json`)**:
   - **If `hasStatusCandidates: true` (and `hasStatus: false`)**: Read `status/_raw_candidates.md` and complete [references/mvu-conversion.md](references/mvu-conversion.md) **before the opening scene**:
     - Write `state.json` + `status/rules.md` (relocate static anatomy constants to lore; drop JS-computed formula fields — never silently drop fields without reporting).
     - Strip any remaining inline status-bar instructions from `card/character.md`, `worldbook/always.md`, and `card/greetings/*.md` (when status candidates originate from greetings; for `preset/`, patch in `preset/overrides.json` + run `preset.js compile`).
     - Delete `status/_raw_candidates.md` and set `"hasStatus": true` in `campaign.json`.
     - Present the **Onboarding Status Report** + `node "<skill_dir>/scripts/hud.js"` **during onboarding BEFORE the opening greeting**, and wait for confirmation/greeting pick so OOC conversion notes never share a message with RP prose or leak into RP turns.
   - **If `hasStatusCandidates: false`**: Do **not** create `state.json` or `status/`, do **not** set `hasStatus: true`, and do **not** suggest a second terminal.
4. **Opening scene**: Read `card/greetings/greeting-*.md`. If multiple greetings exist and the user hasn't picked one, offer a quick choice; otherwise output the clean greeting (recording `## Opening` in `memory/full/chapter-01.md` while keeping `currentTurn: 0`).

## Per-Turn Roleplay Loop (Positive Recipe)

Execute these three steps in order on every in-character player turn:

### 1. On-Demand Lookup (Skip When Context Suffices)
- If a new character, location, or lore term appears: check `worldbook/index.md`, then read **only** the matching `worldbook/entries/<file>.md`.
- If the player references faded past events: locate the chapter/turn via `memory/summary/` first (see [references/memory-guide.md](references/memory-guide.md)).
- **Do NOT** re-read the active `memory/full/chapter-XX.md` mid-session when recent turns are already in context.

### 2. Foreground Chat Output (Exact Shape)
Your reply to the player IS:
1. **Pure Literary Prose** matching `card/character.md` and `preset/active.md`:
   - Enter character immediately with zero OOC preamble or assistant meta-commentary.
   - Narrate only `{{char}}`, NPCs, and environment. Even if the player asks `"帮我决定说什么"`, narrate up to the prompt and stop — place suggested lines in `行动选项`, never speak or act for `{{user}}`.
2. **Enabled Preset Add-ons Only** (when active in `preset/active.md`), placed after `---` in **clean Markdown**:
   - Choices (`行动选项`): `**行动选项**` followed by a Markdown bullet list (`- ...`).
   - Author/cat note (`猫猫留言`): Markdown blockquote (`> 留言：...`).

**Forbidden in chat output**: `<game>`, `<options>`, `<option>`, `<comment>`, `<thinking>`, `<think_nya>`, `<summary>`, `<mvu-status/>`, status codeblocks, `state.json` JSON, or OOC `[状态栏适配说明]` notes.

### 3. Silent Background Settlement (Every Turn)
Update disk files silently (never narrate file edits in chat):
1. **Append turn**: Append `## Turn <N>` (`{{user}}` input + your clean literary prose, omitting `---` add-ons) to the current `memory/full/chapter-XX.md`.
2. **Update state (conditional)**: **If `"hasStatus": true` in `campaign.json`**, update `state.json` strictly from events in this turn per `status/rules.md`.
3. **Increment counter**: Set `currentTurn` to `N` (`old + 1`) in `campaign.json`.
4. **Check memory rollover triggers** (templates in [references/memory-guide.md](references/memory-guide.md)):
   - **If** `scene naturally shifted` (location change, time skip, or beat resolved) **OR** `turns recorded in current chapter >= 20`:
     1. Append a 100–200 char summary (`chapter-XX#TurnA-B`) to `memory/summary/scenes.md`.
     2. Update `memory/summary/facts.md` in place if relationships, key items, or promises changed (strictly `<= 150` lines).
     3. Increment `currentChapter` in `campaign.json` and create `memory/full/chapter-(XX+1).md`.
   - **If** `scenes.md` has `>= 5` scenes since the last entry in `arcs.md`:
     - Distill those 5 scenes into one 200–300 char arc entry and append to `memory/summary/arcs.md`.

## Low-Token Resume Protocol

When starting a new session or recovering after context compression, read **ONLY** this fixed budget:
1. `campaign.json`
2. `card/character.md`
3. `worldbook/always.md` and `worldbook/index.md`
4. `preset/active.md` (if `hasPreset: true`)
5. `state.json` and `status/rules.md` (if `hasStatus: true`)
6. `memory/summary/facts.md`, `memory/summary/arcs.md`, and **only the last 3 entries** of `memory/summary/scenes.md`
7. **Only the tail (last 3–5 turns)** of the current `memory/full/chapter-XX.md`

**Never** bulk-read `memory/full/chapter-*.md` or `worldbook/entries/*.md`.

## OOC Commands (Preset Toggle, Rollback, HUD)

Only step out of character when the player issues an explicit OOC request:
- **Inspect preset**: `node "<skill_dir>/scripts/preset.js" list`
- **Toggle preset entries**:
  ```bash
  node "<skill_dir>/scripts/preset.js" toggle --enable "<index|id|name>" --disable "<index|id|name>"
  ```
  Re-read `preset/active.md` immediately after toggling (`preset/overrides.json` survives every toggle). Run `preset.js compile` after manual `overrides.json` edits.
- **Rewrite last turn (`"重写上一轮"`)**: Replace only the trailing `## Turn <N>` block in the current `memory/full/chapter-XX.md` (keep `currentTurn` unchanged), recompute `state.json` from pre-turn values + the revised turn if `hasStatus: true`, and update the latest `scenes.md` / `facts.md` entry if that turn had triggered rollover.
- **Status HUD**: When `hasStatus: true`, the player monitors `state.json` live in a second terminal via `node "<skill_dir>/scripts/hud.js"`.

## Three Iron Laws & Rationalization Counters

1. **Zero OOC (严禁出戏)**: Never break character or mix OOC notices into RP turns.
2. **Respect User Agency (严禁越界代演)**: Never invent dialogue, inner thoughts, or actions for `{{user}}`.
3. **Clean Prose (严禁正文污染)**: Never leak XML tags, thinking chains, status codeblocks, or JSON into chat.

| Rationalization / Excuse | Reality |
|---|---|
| `"User said '快点直接开局别问东问西', so skip the folder check"` | A non-empty folder without `campaign.json` may be a live codebase. Exit `2` means STOP and ask once: `--dir <subdir>` or `--force`. |
| `"Card says '绝对禁止遗漏任何一项', so keep all 30 static/JS fields"` | Static constants go to lore; JS formulas fail without DOM. Convert dynamic fields, drop unrunnable ones, and report honestly **before** greeting. |
| `"I'll put a quick [状态栏适配说明] banner above Turn 1 prose"` | Mixing OOC conversion notes into RP prose breaks immersion. Finish reporting in onboarding **before** the opening scene. |
| `"Preset mentions 行动选项/猫猫留言, so emit <options>/<comment> XML"` | XML tags are frontend regex hooks. Render enabled add-ons in clean Markdown after `---`. |
| `"User asked '帮我决定说什么', so I can speak/act for {{user}}"` | Suggesting options ≠ hijacking `{{user}}`. Stop before `{{user}}` acts and put choices in `行动选项`. |
| `"No big plot shift at Turn 20, so I'll skip summarizing for now"` | `>= 20` turns in a chapter is a hard rollover trigger. Append `scenes.md`, update `facts.md`, and start `chapter-(XX+1).md`. |
| `"Better read all of memory/full/ and worldbook/entries/ to be sure"` | Full reads explode token budget. Use `facts.md` + `scenes.md` + `worldbook/index.md` for targeted reads only. |

## Red Flags — STOP Before Proceeding

- Running `init.js --force` without asking on a non-empty non-campaign directory
- Writing any campaign file inside `<skill_dir>`
- Dropping status fields silently, or mixing OOC adaptation banners into an RP turn
- Emitting `<options>`, `<option>`, `<comment>`, `<game>`, `<thinking>`, `<think_nya>`, or status codeblocks
- Speaking or deciding actions on behalf of `{{user}}`
- Skipping `chapter-XX.md` append, `state.json` update (`hasStatus: true`), or the 20-turn / scene-shift rollover
- Bulk-reading `memory/full/` or `worldbook/entries/`, or re-reading the active `chapter-XX.md` mid-session
