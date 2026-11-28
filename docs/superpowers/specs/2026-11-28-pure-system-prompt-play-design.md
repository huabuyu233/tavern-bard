# Design Spec: Pure System-Prompt CLI Mode, Non-Refusal Onboarding, & Day-2 Play Resume (`v1.1.0`)

**Date:** 2026-11-28
**Status:** Approved by user in chat

## Problem Statement

1. **Top-Level Coding-Assistant Persona Overrides `AGENTS.md`**: Even with `preset/active.md` synced into `AGENTS.md`, CLI agents load thousands of tokens of built-in coding-assistant instructions at the highest system-prompt tier. Official CLI mechanisms exist to replace those built-in system instructions cleanly while keeping all filesystem tools (needed for dual-layer memory, on-demand worldbook lookup, and `state.json` / `hud.js`).
2. **AI Summarizing/Rewriting Jailbreaks During Onboarding Triggers Early Refusals**: Asking the default (unswitched) onboarding agent to read, summarize, and rewrite sensitive jailbreak/NSFW prompts into `"__sandbox__"` risks triggering assistant moralizing refusals or softening jailbreak directives before play even begins.
3. **Closed Desktop Hosts Need Honest Fallback**: Closed desktop/IDE hosts (Antigravity, Cursor, Windsurf, etc.) do not expose an official CLI system-prompt replacement hook.
4. **Day-2 Resume Must Be Effortless**: Returning days later must immediately reactivate the pure system-prompt environment without making players hunt for long flags, and must gracefully warn if a player accidentally opens a standard `codex`/`claude` session.

## Architecture & Guarantees

1. **Zero-Refusal Onboarding (`workspace-agents.js` + `SKILL.md`)**:
   - Preset jailbreaks, prefills, and scale directives are passed through **100% verbatim by deterministic scripts** (`preset-compiler.js`).
   - `_onboarding_audit.md` explicitly **forbids** AI from summarizing, paraphrasing, or softening jailbreak/NSFW entries; AI fallback strictly handles non-sensitive cleanup (card build comments, web-UI forms, restoring falsely auto-disabled entries, converting `status/_raw_candidates.md`).
2. **Two-Phase Setup & Handoff (`pure-env.js` + `env-setup.js`)**:
   - Players still initialize in *any* blank folder using *any* agent they prefer.
   - Instead of jumping straight into Turn 0 prose, `init.js --finalize-audit` generates `.tavern-bard/system-prompt.md` (marked with `[TAVERN-BARD PURE NARRATOR ENVIRONMENT ACTIVE]`), and `env-setup.js` configures official project-level overrides for supported CLIs (`codex`, `claude`, `opencode`, `gemini`).
   - Supported CLI hosts print launch commands (`npx tavern-bard play` + native CLI command) and stop cleanly for restart. Closed desktop/IDE hosts regretfully state pure system-prompt replacement is unavailable, list any installed CLI alternatives, and offer `"直接在这里开始"` standard compatibility mode.
3. **Full-Tool Pure Environment & Day-2 `tavern-bard play` (`bin/tavern-bard.js`)**:
   - `.tavern-bard/system-prompt.md` retains complete filesystem tool instructions for `memory/`, `worldbook/`, and `state.json` while removing all coding-assistant framing and embedding active preset directives.
   - `npx tavern-bard play [--cli <name>] [--dir <dir>] [--dry-run]` auto-resolves the preferred/installed CLI, syncs `.tavern-bard/system-prompt.md` + project configs, distinguishes first-launch (`currentTurn === 0` and no `## Opening`) from Day-2+ resume, and spawns the interactive CLI cleanly on Windows & POSIX.
   - If a player returns in bare `codex`/`claude` (without `PURE_ENV_MARKER`), `AGENTS.md` reminds them once how to resume via `npx tavern-bard play`.
