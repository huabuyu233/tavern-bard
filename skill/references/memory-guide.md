# Two-Layer Memory & Retrieval Guide

Primary memory is the active CLI context window anchored by `AGENTS.md` / `CLAUDE.md`. On-disk `memory/` provides lossless archive (`memory/full/`) and bounded summaries (`memory/summary/`) so campaigns stay low-token across hundreds of turns.

```text
memory/
├── summary/
│   ├── facts.md    # In-place core facts table (strictly <= 150 lines)
│   ├── scenes.md   # Append-only chronological scene summaries (100-200 chars each)
│   └── arcs.md     # Append-only 5-scene arc consolidations (200-300 chars each)
└── full/
    ├── chapter-01.md
    └── chapter-02.md
```

## 1. Per-Turn Transcript Append (`memory/full/chapter-XX.md`)

At the end of every RP turn, append **only** the new turn to the active `memory/full/chapter-XX.md` (where `XX` is two-digit zero-padded `campaign.currentChapter`, e.g., `chapter-01.md`). **Never** re-read the entire chapter just to append.

```markdown
## Turn 20

**林渊**: 我推门走进酒馆，环顾四周。

<clean literary prose only — omit `---` add-ons such as 行动选项 or 猫猫留言>
```

- **Opening greeting**: When starting a campaign, you may record `## Opening` above `## Turn 1` without changing `currentTurn: 0`.
- **Rollback (`"重写上一轮"`)**: Edit only the trailing `## Turn <N>` section at the end of the current `chapter-XX.md` in place; keep `currentTurn` unchanged.

## 2. Observable Rollover & Summary Triggers

### Scene Summary + Chapter Rollover
**Trigger** (fires when **either** condition is true):
1. **Scene shift**: Location changes, meaningful time skip occurs, or a distinct confrontation/conversation beat concludes; **OR**
2. **20-turn ceiling**: The current `memory/full/chapter-XX.md` now contains **`>= 20` turns** (`## Turn ...` headings inside that chapter file, regardless of earlier rollovers).

**Action (all 3 steps)**:
1. **Append to `memory/summary/scenes.md`** (strictly append-only — never rewrite earlier scene entries):
   ```markdown
   ## Scene 1 (`chapter-01#Turn1-20`)
   林渊在旧城区小酒馆落脚并试探掌柜态度，双方维持谨慎试探，尚未达成交易约定；临近深夜窗外起雾，酒馆暗处仍有视线窥探。
   ```
2. **Update `memory/summary/facts.md` in place** (only if new characters, relationship shifts, key items, or promises/hooks appeared):
   - Keep under the three fixed headings:
     - `## 人物关系与印象`
     - `## 关键物品与状态`
     - `## 约定与未解伏笔`
   - **Hard budget: strictly `<= 150` lines**. Merge or archive resolved bullets into `scenes.md` / `arcs.md` rather than letting `facts.md` grow past 150 lines.
3. **Roll chapter**: Increment `currentChapter` in `campaign.json` (`1 -> 2`) and create `memory/full/chapter-02.md` (`# Chapter 02\n`).

### Arc Consolidation (`memory/summary/arcs.md`)
**Trigger**: `memory/summary/scenes.md` has **`>= 5` unsummarized scene entries** since the last arc entry in `arcs.md`.

**Action**: Read only those 5 recent scene entries, synthesize a 200–300 char arc summary covering major plot shifts and lasting consequences, and **append** to `memory/summary/arcs.md`:

```markdown
## Arc 1 (`Scene 1-5` | `chapter-01`–`chapter-04`)
...200–300 char consolidated arc summary...
```

## 3. Low-Token Resume & Targeted Recall

### Fresh Session / Post-Compression Budget
Read **ONLY** these files (never read all of `memory/full/` or `worldbook/entries/`):
1. `campaign.json`
2. `card/character.md`
3. `worldbook/always.md` and `worldbook/index.md`
4. `preset/active.md` (if `hasPreset: true`)
5. `state.json` and `status/rules.md` (if `hasStatus: true`)
6. `memory/summary/facts.md`, `memory/summary/arcs.md`, and **the last 3 entries** of `memory/summary/scenes.md`
7. **Tail (last 3–5 turns)** of the latest `memory/full/chapter-XX.md`

### Mid-Session Detail Recall (e.g., `"第一章破庙埋的玉佩"`)
Follow this strict narrow-down sequence:
1. Read `memory/summary/facts.md` (already in resume context) to check current state/clues.
2. Scan `memory/summary/scenes.md` (or `arcs.md`) to pinpoint the exact chapter & turn range (e.g., `chapter-01#Turn4-9`).
3. Search/grep **only that target file** (`memory/full/chapter-01.md`) for the keyword (`玉佩`), then read only the surrounding line range (`StartLine..EndLine`) covering that turn.
   - Only grep across other `chapter-*.md` files if `facts.md` and `scenes.md` do not identify which chapter holds the detail.

### On-Demand Worldbook Lookup
1. Scan `worldbook/index.md` to find the exact filenames matching active keywords/entities (e.g., `012-少林寺.md`, `013-心鉴方丈.md`).
2. Read **only** those specific `worldbook/entries/*.md` files.
3. Never read `worldbook/disabled/` unless the player explicitly asks to inspect or re-enable a disabled entry.
