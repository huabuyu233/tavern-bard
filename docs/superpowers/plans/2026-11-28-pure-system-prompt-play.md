# Pure System-Prompt CLI Mode & Day-2 Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable universal zero-refusal onboarding followed by official CLI system-prompt replacement (`env-setup.js` + `npx tavern-bard play`) while preserving full filesystem tools (`memory/`, `worldbook/`, `state.json`), graceful desktop-host reporting, and effortless Day-2 resume.

**Architecture:** Deterministic scripts pass preset jailbreaks verbatim into `.tavern-bard/system-prompt.md` (tagged `[TAVERN-BARD PURE NARRATOR ENVIRONMENT ACTIVE]`) and sync it alongside `AGENTS.md`. Host/CLI detection (`pure-env.js`) writes official project overrides (`.opencode/`, `.claude/`, `.gemini/.env`) or Codex instructions flags, while `bin/tavern-bard.js play` automates Day-1 start and Day-2 low-token resume.

**Tech Stack:** Node.js >= 18 (zero external dependencies), `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-28-pure-system-prompt-play-design.md`

## Global Constraints

- Zero external npm runtime dependencies; Node.js >= 18 standard library only.
- 100% agent-agnostic and preset-agnostic; use only documented official CLI override flags/configs.
- Windows PowerShell 5.1 compatibility (avoid `&&` in commands; handle `.cmd`/`.ps1`/`.exe` shims safely in `spawn`).
- Strictly preserve live campaign data (`memory/`, `state.json`) during upgrades.
- Never run `git push` or `npm publish` without explicit user permission.

## Review Focus

- AI must NOT be instructed to summarize/rewrite jailbreak/NSFW entries during onboarding (prevents early assistant refusals).
- Pure system-prompt sessions MUST see `[TAVERN-BARD PURE NARRATOR ENVIRONMENT ACTIVE]` and NEVER loop asking the user to restart again.
- Day-2 resume at `currentTurn > 0` or `## Opening` in `chapter-01.md` selects resume prompt; `currentTurn === 0` without `## Opening` selects opening prompt.
- Preset edits (`toggle`, `compile`, `load`, `--finalize-audit`) keep `.tavern-bard/system-prompt.md`, `.opencode/agents/tavern-bard.md`, `.claude/agents/tavern-bard.md`, and `AGENTS.md` in sync.
- Windows CLI launcher (`bin/tavern-bard.js play`) resolves `.cmd` / `.exe` / `.ps1` shims without shell-quoting corruption on Chinese prompts.

---

### Task 1: De-Sensitize Onboarding Audit & Add Day-2 Standard-Mode Reminder

**Files:**
- Modify: `skill/scripts/lib/workspace-agents.js`
- Test: `tests/init.test.js`

**Interfaces:**
- Produces updated `buildOnboardingAuditMd(...)` (no `__sandbox__` prompt rewriting) and `buildAgentsMd({ ..., pureEnvPrepared, preferredCli })` / `syncWorkspaceAgentsMd(...)` (passes `pureEnvPrepared`, `preferredCli` from `campaign.json`).

- [ ] **Step 1:** Add/update tests in `tests/init.test.js` verifying `_onboarding_audit.md` forbids AI rewriting jailbreak/NSFW text and `AGENTS.md` renders the Day-2 pure-mode resume reminder when `pureEnvPrepared: true`.
- [ ] **Step 2:** Verify RED (`node --test tests/init.test.js` fails before implementation).
- [ ] **Step 3:** Update `skill/scripts/lib/workspace-agents.js`.
- [ ] **Step 4:** Verify GREEN (`npm test` passes completely) and commit.

---

### Task 2: Pure System-Prompt Builder & Official CLI Configurator (`pure-env.js` + `env-setup.js` + hooks)

**Files:**
- Create: `skill/scripts/lib/pure-env.js`, `skill/scripts/env-setup.js`, `tests/pure-env.test.js`
- Modify: `skill/scripts/init.js`, `skill/scripts/preset.js`

**Interfaces:**
- `PURE_ENV_MARKER`: `'[TAVERN-BARD PURE NARRATOR ENVIRONMENT ACTIVE]'`
- `buildPureSystemPromptMd({ char, user, hasPreset, hasStatus, activePresetMd, skillDir })`
- `detectAgentEnvironment({ env, explicitAgent, commandExists })`
- `formatNativeLaunchCommand(cli, { isResume, platform })`
- `setupPureEnvironment({ dir, agent, skillDir, env, commandExists })`
- `syncPureEnvironmentFiles(targetDir, { activePresetMd, skillDir })`
- `resolveCliExecutable(cli, { env, platform })`

- [ ] **Step 1:** Write comprehensive failing tests in `tests/pure-env.test.js` covering pure prompt generation (zero coding terms, full tools, active preset verbatim), host/CLI detection, `.opencode/`/`.claude/`/`.gemini/` file generation + `opencode.json` non-overwrite protection, unsupported desktop reporting, `env-setup.js` CLI JSON/text output, and `preset.js toggle` sync to `.tavern-bard/system-prompt.md`.
- [ ] **Step 2:** Verify RED (`node --test tests/pure-env.test.js` fails).
- [ ] **Step 3:** Implement `skill/scripts/lib/pure-env.js`, `skill/scripts/env-setup.js`, and wire `syncPureEnvironmentFiles` into `init.js` (`--finalize-audit`) & `preset.js` (`toggle`, `compile`, `load`).
- [ ] **Step 4:** Verify GREEN (`npm test` passes completely) and commit.

---

### Task 3: Unified Day-1 / Day-2 Launcher `npx tavern-bard play` (`bin/tavern-bard.js`)

**Files:**
- Modify: `bin/tavern-bard.js`
- Test: `tests/bin-cli.test.js`

**Interfaces:**
- Exports `{ parseArgs, runPlayCommand }` from `bin/tavern-bard.js` (still executes `main()` only when `require.main === module`).
- `npx tavern-bard play [--cli <codex|claude|opencode|gemini>] [--dir <dir>] [--dry-run]`

- [ ] **Step 1:** Add failing tests in `tests/bin-cli.test.js` covering `--help` mentioning `play`, `play --dry-run` for Day-1 launch (`currentTurn: 0`, no Opening) vs Day-2 resume (`currentTurn > 0` or `## Opening`), `--cli` explicit vs `campaign.preferredCli` persistence, and missing `campaign.json` / no CLI errors.
- [ ] **Step 2:** Verify RED (`node --test tests/bin-cli.test.js` fails).
- [ ] **Step 3:** Implement `parseArgs` extensions and `runPlayCommand` in `bin/tavern-bard.js` with cross-platform Windows `.cmd`/`.exe`/`.ps1` shim resolution.
- [ ] **Step 4:** Verify GREEN (`npm test` passes completely) and commit.

---

### Task 4: Update `SKILL.md`, `README.md`, Bump `1.1.0`, Whole-Branch Review, Deploy & Upgrade Live Campaign

**Files:**
- Modify: `skill/SKILL.md`, `README.md`, `package.json`

- [ ] **Step 1:** Update `skill/SKILL.md` with two-phase Pure Environment Handoff, no jailbreak rewriting rule, restart-loop prevention on `[TAVERN-BARD PURE NARRATOR ENVIRONMENT ACTIVE]`, desktop regret + fallback options, and `"直接在这里开始"` escape hatch.
- [ ] **Step 2:** Update `README.md` with Pure CLI Mode (`tavern-bard play`) vs Desktop Compatibility Mode, and bump `package.json` version to `1.1.0`.
- [ ] **Step 3:** Dispatch fresh whole-branch `research` reviewer subagent to audit all commits/files against spec & quality standards; resolve any Critical/Important issues via TDD.
- [ ] **Step 4:** Run fresh `npm test` + `npm pack --dry-run`, `node scripts/deploy.js`, and upgrade live campaign `D:\Users\huabu\Documents\AI\酒馆\tavern-bard角色扮演\自由使用许可证` via `env-setup.js` (leaving `state.json` and `memory/` untouched), then commit.
