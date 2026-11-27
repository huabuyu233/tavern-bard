# Tavern-Bard npm & GitHub Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package `tavern-bard` as a clean, zero-dependency npm + GitHub CLI installer (`npx tavern-bard` / `npx github:huabuyu233/tavern-bard`), with MIT `LICENSE`, `README.md`, and `origin` remote configured to `git@github.com:huabuyu233/tavern-bard.git`.

**Architecture:** `bin/tavern-bard.js` exposes a single cross-platform CLI (`install` default, `uninstall`, `status`, `--dry-run`, `--help`, `--version`) backed by generalized `scripts/deploy.js`. `package.json` uses `"files"` allowlist so `npm pack` / `npm publish` ships ONLY `bin/`, `skill/`, `scripts/deploy.js`, `README.md`, and `LICENSE` (excluding `docs/`, `tests/`, `示例资源/`).

**Tech Stack:** Node.js v18+ built-ins only (`node:fs`, `node:os`, `node:path`, `node:test`, `node:assert/strict`), CommonJS `.js`.

**Spec:** `docs/superpowers/specs/2026-11-27-npm-github-release-design.md`

---

### Task 1: Generalize `scripts/deploy.js` with `uninstallSkill` & `getDeployStatus`

**Files:**
- Modify: `scripts/deploy.js`
- Modify: `tests/deploy.test.js`

- [ ] **Step 1: Write failing tests in `tests/deploy.test.js`**
  - Verify `getDefaultConfig` does NOT include `ai_agents_config` in `legacyPaths`.
  - Verify `uninstallSkill({ agentsSkillDir, linkTargets, dryRun })` removes `agentsSkillDir` and all `linkTargets` (including broken links) and respects `dryRun: true`.
  - Verify `getDeployStatus({ agentsSkillDir, linkTargets })` reports `{ agentsInstalled, agentsSkillDir, links: [{ path, exists, targetMatches }] }`.
- [ ] **Step 2: Run `node --test tests/deploy.test.js` to verify RED**
- [ ] **Step 3: Implement `uninstallSkill`, `getDeployStatus`, and remove `ai_agents_config` from `getDefaultConfig` in `scripts/deploy.js`**
- [ ] **Step 4: Run `node --test` to verify GREEN and commit**

---

### Task 2: Add `bin/tavern-bard.js` CLI Entrypoint

**Files:**
- Create: `bin/tavern-bard.js`
- Test: `tests/bin-cli.test.js`

- [ ] **Step 1: Write failing tests in `tests/bin-cli.test.js`**
  - Test `node bin/tavern-bard.js --help` (exits `0`, prints `install`, `uninstall`, `status`, `--dry-run`, `--version`).
  - Test `node bin/tavern-bard.js --version` (exits `0`, prints `package.json` version).
  - Test `node bin/tavern-bard.js --dry-run` and `node bin/tavern-bard.js install` / `status` / `uninstall` with isolated `HOME` & `USERPROFILE` env vars in a temp dir.
- [ ] **Step 2: Run `node --test tests/bin-cli.test.js` to verify RED**
- [ ] **Step 3: Implement `bin/tavern-bard.js` (`#!/usr/bin/env node`) calling `deploySkill`, `uninstallSkill`, `getDeployStatus` from `../scripts/deploy`**
- [ ] **Step 4: Run `node --test` to verify GREEN and commit**

---

### Task 3: Add `package.json`, `LICENSE`, `README.md`, and Configure Git Remote

**Files:**
- Create: `package.json`
- Create: `LICENSE`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`** with `name: "tavern-bard"`, `version: "1.0.0"`, `description`, `license: "MIT"`, `bin: { "tavern-bard": "bin/tavern-bard.js" }`, `files: ["bin/", "skill/", "scripts/deploy.js", "README.md", "LICENSE"]`, `scripts: { "test": "node --test" }`, `engines: { "node": ">=18" }`, `repository` / `bugs` / `homepage` pointing to `https://github.com/huabuyu233/tavern-bard`, and `keywords`.
- [ ] **Step 2: Create MIT `LICENSE` and `README.md`** (with one-line `npx tavern-bard` & `npx github:huabuyu233/tavern-bard` install, supported CLI agents, dual-terminal HUD usage, and workspace structure).
- [ ] **Step 3: Verify `npm pack --dry-run` contains ONLY `bin/`, `skill/`, `scripts/deploy.js`, `README.md`, `LICENSE`, `package.json` (zero `tests/`, `docs/`, `示例资源/`) and run `npm test` (`node --test`).**
- [ ] **Step 4: Configure `git remote add origin git@github.com:huabuyu233/tavern-bard.git` (if not set) and commit `package.json`, `LICENSE`, `README.md`.**
