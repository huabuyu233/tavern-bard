# Tavern-Bard npm & GitHub 公开发布设计文档

- **日期**：2026-11-27
- **仓库**：`git@github.com:huabuyu233/tavern-bard.git`
- **npm 包名**：`tavern-bard`（MIT 开源，零第三方依赖）

## 目标与方案选型

让任意用户无需手动克隆或拷贝目录，直接通过以下任意方式将 `tavern-bard` 安装到 `~/.agents/skills/tavern-bard/` 并联接至 `~/.claude/skills/tavern-bard` 与 `~/.gemini/config/skills/tavern-bard`：
1. `npx tavern-bard`（npm 官方源一键安装）
2. `npx github:huabuyu233/tavern-bard`（GitHub 仓库一键安装）
3. `npm install -g tavern-bard && tavern-bard`（全局安装后执行一次）

**选型**：采用标准 `package.json` `bin` 入口（**方案 A**），不采用 `postinstall` 钩子（避免 pnpm / 新版 npm 安全策略拦截）。

## 改动范围

1. **通用化 `scripts/deploy.js`**：
   - 从公开默认 `legacyPaths` 中移除作者私人路径 `~/ai_agents_config/.gemini/config/skills/tavern-bard`；
   - 新增 `uninstallSkill()` 与 `getDeployStatus()`，支持 `install` / `uninstall` / `status` 与 `--dry-run`。
2. **新增 `bin/tavern-bard.js`**：
   - 统一 CLI 入口（带 `#!/usr/bin/env node`），默认子命令为 `install`，支持 `install`、`uninstall`、`status`、`--dry-run`、`--help`、`--version`。
3. **新增 `package.json`、`LICENSE`（MIT）、`README.md`**：
   - `package.json` 通过 `"files"` 白名单严格仅包含 `bin/`、`skill/`、`scripts/deploy.js`、`README.md`、`LICENSE`，绝不将 `tests/`、`docs/`、`示例资源/` 打入 npm 包；
   - `README.md` 提供类脑社区风格的中文介绍、一键安装命令、双终端 HUD 使用说明及目录说明。
4. **配置 Git `origin` 并验证 `npm pack --dry-run`**：
   - 绑定 `git remote add origin git@github.com:huabuyu233/tavern-bard.git`（推送与 `npm publish` 由用户或用户明确授权后执行）。
