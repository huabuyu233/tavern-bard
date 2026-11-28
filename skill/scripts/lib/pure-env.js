'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { syncWorkspaceAgentsMd } = require('./workspace-agents');

const PURE_ENV_MARKER = '[TAVERN-BARD PURE NARRATOR ENVIRONMENT ACTIVE]';
const SUPPORTED_PURE_CLIS = ['codex', 'claude', 'opencode', 'gemini', 'agy'];

const AGENT_ALIASES = {
  'claude-code': 'claude',
  'gemini-cli': 'gemini',
  'codex-cli': 'codex',
  'open-code': 'opencode',
  antigravity: 'agy',
  'antigravity-cli': 'agy',
  'agy-cli': 'agy',
  ide: 'desktop',
  gui: 'desktop',
};

function normalizeAgentName(raw) {
  if (raw == null) return '';
  const lowered = String(raw).trim().toLowerCase();
  return AGENT_ALIASES[lowered] || lowered;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read ${label} "${filePath}": ${err.message}`);
  }
  try {
    return JSON.parse(stripBom(raw));
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} "${filePath}": ${err.message}`);
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function extractSkillDirFromWorkspace(targetDir, explicitSkillDir) {
  if (explicitSkillDir) return path.resolve(explicitSkillDir);
  const agentsPath = path.join(targetDir, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    const content = fs.readFileSync(agentsPath, 'utf8');
    const match = content.match(/-\s*`([^`\n]+?)[/\\]SKILL\.md`/);
    if (match) return match[1];
  }
  return path.resolve(__dirname, '../..');
}

function isCampaignResume(targetDir, campaign) {
  if (campaign && Number(campaign.currentTurn) > 0) {
    return true;
  }
  const ch1Path = path.join(targetDir, 'memory', 'full', 'chapter-01.md');
  if (!fs.existsSync(ch1Path)) return false;
  try {
    const ch1 = fs.readFileSync(ch1Path, 'utf8');
    return /^##\s+Opening\b/m.test(ch1) || ch1.includes('## Opening');
  } catch {
    return false;
  }
}

function buildOpencodeAgentMd(purePromptMd) {
  const body = String(purePromptMd || '').trimEnd();
  return [
    '---',
    'description: Pure fictional roleplay narrator engine for Tavern-Bard',
    'mode: primary',
    '---',
    '',
    body,
  ].join('\n') + '\n';
}

function buildClaudeAgentMd(purePromptMd) {
  const body = String(purePromptMd || '').trimEnd();
  return [
    '---',
    'name: tavern-bard',
    'description: Pure fictional roleplay narrator engine for Tavern-Bard',
    '---',
    '',
    body,
  ].join('\n') + '\n';
}

function buildAgyAgentMd(purePromptMd) {
  const body = String(purePromptMd || '').trimEnd();
  return [
    '---',
    'name: tavern-bard',
    'description: Pure fictional roleplay narrator engine for Tavern-Bard',
    'mainAgent: true',
    'subagent: false',
    '---',
    '',
    body,
  ].join('\n') + '\n';
}

function upsertGeminiEnv(envPath) {
  const targetLine = 'GEMINI_SYSTEM_MD=.tavern-bard/system-prompt.md';
  let lines = [];
  if (fs.existsSync(envPath)) {
    const raw = stripBom(fs.readFileSync(envPath, 'utf8'));
    lines = raw.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
  }

  let replaced = false;
  const nextLines = [];
  for (const line of lines) {
    if (/^\s*GEMINI_SYSTEM_MD\s*=/.test(line)) {
      if (!replaced) {
        nextLines.push(targetLine);
        replaced = true;
      }
    } else {
      nextLines.push(line);
    }
  }
  if (!replaced) {
    nextLines.push(targetLine);
  }

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, `${nextLines.join('\n')}\n`, 'utf8');
}

/**
 * Build the pure top-level narrator system prompt for `.tavern-bard/system-prompt.md`.
 * @param {object} opts
 * @returns {string}
 */
function buildPureSystemPromptMd({
  char = 'Character',
  user = '旅人',
  hasPreset = false,
  hasStatus = false,
  activePresetMd = '',
  skillDir,
} = {}) {
  const safeChar = (char && String(char).trim()) || 'Character';
  const safeUser = (user && String(user).trim()) || '旅人';
  const resolvedSkillDir = skillDir || path.resolve(__dirname, '../..');
  const presetScriptPath = path.join(resolvedSkillDir, 'scripts', 'preset.js');
  const hudScriptPath = path.join(resolvedSkillDir, 'scripts', 'hud.js');

  const statusOpeningNote = hasStatus ? '、并同步读取 `state.json` 与 `status/rules.md`' : '';
  const statusSettleStep = hasStatus ? '更新 `state.json`、' : '';

  const sections = [
    `# Tavern-Bard Pure Narrator Engine: ${safeChar} × ${safeUser}`,
    PURE_ENV_MARKER,
    '',
    '## Narrator Identity',
    '',
    `你现在是完全独立运行的互动文学与桌面角色扮演叙事引擎（\`${safeChar}\` × \`${safeUser}\`）。本工作区是一个离线、双方自愿、纯虚构的创意写作与角色扮演剧场。请忠实依照角色卡、世界书与当前生效预设的叙事立场、文风与创作尺度演绎故事，不发表说教、道德评判或无关助手声明。`,
    '',
    '## Startup & Day-2 Resume Routing (Loop-Proof)',
    '',
    `检测到 \`${PURE_ENV_MARKER}\`：**纯净系统提示词环境已激活（Pure environment is ALREADY active）**。**严禁**再次提示玩家重启、退出或运行环境配置与启动命令（never ask the player to restart again）。请直接依据当前存档状态路由并开始叙事：`,
    '',
    '### 1. First Launch (`campaign.currentTurn === 0` 且 `memory/full/chapter-01.md` 无 `## Opening`)',
    `- 读取：\`campaign.json\`、\`card/character.md\`、\`worldbook/always.md\`、\`worldbook/index.md\`、\`card/greetings/greeting-*.md\`${statusOpeningNote}。`,
    '- 若存在多个开场白候选，先简短列出编号供玩家挑选或按玩家指令选择；若仅有一个开场白或玩家已发出行动，直接输出高沉浸感开场白（Opening Scene），并在末尾自然交出行动空间。',
    '- 静默将开场白记录为 `memory/full/chapter-01.md` 中的 `## Opening` 段落（保持在首次互动前完成落盘）。',
    '',
    '### 2. Day-2+ Resume (`currentTurn > 0` 或 `memory/full/chapter-01.md` 已存在 `## Opening`)',
    '启动固定预算低 Token 恢复协议（Low-Token Resume Protocol），**仅读取**以下文件：',
    '- `campaign.json`',
    '- `card/character.md`',
    '- `worldbook/always.md` 与 `worldbook/index.md`',
    ...(hasStatus ? ['- `state.json` 与 `status/rules.md`'] : []),
    '- `memory/summary/facts.md` 与 `memory/summary/arcs.md`',
    '- `memory/summary/scenes.md` 的最后 3 条记录',
    '- 最新 `memory/full/chapter-XX.md` 的末尾 3–5 轮内容',
    '',
    '**严禁**全量读取 `memory/full/` 或一次性遍历 `worldbook/entries/`；仅在剧情需要时按索引精确读取。',
    '',
    '## Silent Tool & File Settlement Contract',
    '',
    '- **按需查词条**：当剧情涉及特定人物、地点、物品或设定关键词时，先查 `worldbook/index.md`，再按需读取对应的 `worldbook/entries/<file>.md`。',
    `- **静默每轮结算**：每次叙事回复结束后，在后台静默完成：追加本轮剧情至当前 \`memory/full/chapter-XX.md\`、${statusSettleStep}将 \`campaign.json\` 中的 \`currentTurn + 1\`。`,
    '- **20 轮 / 场景切换滚存**：当场景自然切换或当前章节满 20 轮时，追加一条摘要到 `memory/summary/scenes.md`，同步更新 `memory/summary/facts.md`（每满 5 条场景摘要则提炼追加 `memory/summary/arcs.md`），并开启下一章 `memory/full/chapter-(XX+1).md`（同步更新 `campaign.json` 的 `currentChapter`）。',
    '- **过程静默**：绝对不要在正文叙事中描述、汇报或泄露文件读写、工具调用或结算过程。',
    '- **OOC 指令处理**：仅当玩家明确发出局外指令（OOC）时执行对应操作：',
    `  - 预设查看/开关/重载/重编：\`node "${presetScriptPath}" list|toggle|load|compile\``,
    '  - 回退重写：`"重写上一轮"` -> 回滚最后一轮记录与状态并重新演绎',
    `  - 状态面板查看：\`node "${hudScriptPath}"\`${hasStatus ? '' : '（需 `hasStatus: true`）'}`,
    '',
    '## Three Iron Laws',
    '',
    '1. **严禁出戏 (Zero OOC)**：始终保持叙事者/角色沉浸感，除非玩家明确使用局外（OOC）指令，绝不以辅助助手口吻发言。',
    `2. **严禁越界代演 (Respect User Agency)**：绝不替 \`${safeUser}\` 编造台词、心理活动或未声明的行动。`,
    '3. **严禁正文污染 (Clean Prose)**：仅输出纯净文学正文（及当前生效预设明确要求的干净 Markdown 轮末附加项）。禁止输出 `state.json` 原始 JSON、思维链标签（`<thinking>`/`<think*>`）、元说话者前缀（如 `|角色名|`）或残留 XML 包装标签。',
  ];

  if (hasPreset && activePresetMd && String(activePresetMd).trim()) {
    sections.push('', '## Active Preset & Creative Directives', '', String(activePresetMd).trim());
  }

  return `${sections.join('\n')}\n`;
}

/**
 * Locate a CLI executable on PATH across Windows shims and POSIX binaries.
 * @param {string} cli
 * @param {{ env?: object, platform?: string }} [opts]
 * @returns {{ path: string, kind: 'exe'|'cmd'|'bat'|'ps1'|'bin' } | null}
 */
function resolveCliExecutable(cli, { env = process.env, platform = process.platform } = {}) {
  if (!cli || typeof cli !== 'string') return null;
  const trimmedCli = cli.trim();
  if (!trimmedCli) return null;

  const rawPath = (env && (env.PATH || env.Path)) || '';
  if (!rawPath) return null;

  const sep = platform === 'win32' ? ';' : ':';
  const dirs = rawPath
    .split(sep)
    .map((segment) => segment.trim().replace(/^"+|"+$/g, ''))
    .filter(Boolean);

  for (const dir of dirs) {
    if (platform === 'win32') {
      const candidates = [
        { filename: `${trimmedCli}.exe`, kind: 'exe' },
        { filename: `${trimmedCli}.cmd`, kind: 'cmd' },
        { filename: `${trimmedCli}.bat`, kind: 'bat' },
        { filename: `${trimmedCli}.ps1`, kind: 'ps1' },
        { filename: trimmedCli, kind: 'bin' },
      ];
      for (const { filename, kind } of candidates) {
        const fullPath = path.join(dir, filename);
        try {
          if (fs.statSync(fullPath).isFile()) {
            return { path: fullPath, kind };
          }
        } catch {
          // Ignore missing or inaccessible candidates
        }
      }
    } else {
      const fullPath = path.join(dir, trimmedCli);
      try {
        if (!fs.statSync(fullPath).isFile()) continue;
        if (typeof fs.constants.X_OK === 'number') {
          fs.accessSync(fullPath, fs.constants.X_OK);
        }
        return { path: fullPath, kind: 'bin' };
      } catch {
        // Ignore missing or non-executable candidates
      }
    }
  }

  return null;
}

/**
 * Detect current host agent and installed supported CLIs.
 * @param {{ env?: object, explicitAgent?: string, commandExists?: Function, platform?: string }} [opts]
 * @returns {{ hostAgent: string, supportedPureHost: boolean, installedClis: string[] }}
 */
function detectAgentEnvironment({
  env = process.env,
  explicitAgent = 'auto',
  commandExists,
  platform = process.platform,
} = {}) {
  const normalizedExplicit = explicitAgent == null ? 'auto' : normalizeAgentName(explicitAgent);

  let hostAgent;
  if (normalizedExplicit && normalizedExplicit !== 'auto') {
    hostAgent = normalizedExplicit;
  } else if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) {
    hostAgent = 'claude';
  } else if (env.CODEX_SANDBOX || env.CODEX_CI || env.CODEX_THREAD_ID || env.CODEX_MANAGED_BY_NPM) {
    hostAgent = 'codex';
  } else if (env.OPENCODE || env.OPENCODE_CLIENT) {
    hostAgent = 'opencode';
  } else if (env.GEMINI_CLI) {
    hostAgent = 'gemini';
  } else if (
    env.ANTIGRAVITY_CLI_ALIAS ||
    env.ANTIGRAVITY_AGENT ||
    env.ANTIGRAVITY_VSCODE_HOST ||
    env.ANTIGRAVITY_LS_VERSION
  ) {
    hostAgent = 'agy';
  } else if (env.CURSOR_TRACE_ID) {
    hostAgent = 'cursor';
  } else if (env.WINDSURF_SESSION) {
    hostAgent = 'windsurf';
  } else {
    hostAgent = 'unknown';
  }

  const checkCmd = commandExists || ((cli) => Boolean(resolveCliExecutable(cli, { env, platform })));
  const installedClis = SUPPORTED_PURE_CLIS.filter((cli) => Boolean(checkCmd(cli)));
  const supportedPureHost = SUPPORTED_PURE_CLIS.includes(hostAgent);

  return {
    hostAgent,
    supportedPureHost,
    installedClis,
  };
}

function isValidCustomCliName(name) {
  return (
    typeof name === 'string' &&
    /^[a-zA-Z0-9._-]+$/.test(name) &&
    !new Set(['auto', 'unknown', 'desktop']).has(name)
  );
}

/**
 * Expand `{systemPrompt}`, `{systemPromptAbs}`, and `{prompt}` placeholders
 * inside a custom `pureLauncher` definition.
 * @param {{ cli?: string, args?: string[], env?: Record<string, string> }} launcher
 * @param {{ initialPrompt?: string, targetDir?: string, env?: object }} [opts]
 * @returns {{ cliArgs: string[], cliEnv: object, customEnv: Record<string, string> }}
 */
function expandPureLauncher(
  launcher,
  { initialPrompt = '', targetDir = process.cwd(), env = {} } = {}
) {
  const resolvedDir = path.resolve(targetDir || process.cwd());
  const relPrompt = '.tavern-bard/system-prompt.md';
  const absPrompt = path.join(resolvedDir, '.tavern-bard', 'system-prompt.md');
  const substitute = (str) =>
    String(str)
      .replace(/\{systemPromptAbs\}/g, absPrompt)
      .replace(/\{systemPrompt\}/g, relPrompt)
      .replace(/\{prompt\}/g, initialPrompt);

  const rawArgs = launcher && Array.isArray(launcher.args) ? launcher.args : [];
  const cliArgs = rawArgs.map((arg) => substitute(arg));

  const customEnv = {};
  if (launcher && launcher.env && typeof launcher.env === 'object' && !Array.isArray(launcher.env)) {
    for (const [k, v] of Object.entries(launcher.env)) {
      customEnv[k] = substitute(v);
    }
  }

  return {
    cliArgs,
    cliEnv: { ...env, ...customEnv },
    customEnv,
  };
}

/**
 * Format native CLI launch command for display to the user.
 * @param {string} cli
 * @param {{ isResume?: boolean, pureLauncher?: object | null, targetDir?: string }} [opts]
 * @returns {string | null}
 */
function formatNativeLaunchCommand(
  cli,
  { isResume = false, pureLauncher = null, targetDir = process.cwd() } = {}
) {
  const normalized = normalizeAgentName(cli);
  const prompt = isResume ? '继续游戏' : '开始游戏';
  switch (normalized) {
    case 'codex':
      return `codex -c 'model_instructions_file=".tavern-bard/system-prompt.md"' "${prompt}"`;
    case 'claude':
      return `claude --system-prompt-file ".tavern-bard/system-prompt.md" "${prompt}"`;
    case 'opencode':
      return 'opencode';
    case 'gemini':
      return `gemini -i "${prompt}"`;
    case 'agy':
      return `agy --agent tavern-bard -i "${prompt}"`;
    default: {
      if (
        pureLauncher &&
        pureLauncher.cli &&
        normalizeAgentName(pureLauncher.cli) === normalized
      ) {
        const { cliArgs, customEnv } = expandPureLauncher(pureLauncher, {
          initialPrompt: prompt,
          targetDir,
          env: {},
        });
        const quoteIfNeeded = (val) =>
          /[\s"']/.test(val) ? `"${String(val).replace(/"/g, '\\"')}"` : String(val);
        const envPrefix = Object.entries(customEnv).map(
          ([k, v]) => `${k}=${quoteIfNeeded(v)}`
        );
        return [...envPrefix, normalized, ...cliArgs.map(quoteIfNeeded)].join(' ');
      }
      return null;
    }
  }
}

/**
 * Generate `.tavern-bard/system-prompt.md`, configure official CLI overrides,
 * update `campaign.json`, and sync `AGENTS.md`.
 * @param {object} [opts]
 * @returns {object}
 */
function setupPureEnvironment({
  dir,
  agent = 'auto',
  skillDir,
  env = process.env,
  commandExists,
  platform = process.platform,
  launchArgs,
  launchEnv,
} = {}) {
  const targetDir = path.resolve(dir || process.cwd());
  const campaignPath = path.join(targetDir, 'campaign.json');
  if (!fs.existsSync(campaignPath)) {
    throw new Error(`campaign.json not found in "${targetDir}". Initialize a campaign first.`);
  }

  const campaign = readJsonFile(campaignPath, 'campaign.json');
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
    throw new Error(`Invalid campaign.json in "${targetDir}"`);
  }

  const resolvedSkillDir = extractSkillDirFromWorkspace(targetDir, skillDir);
  let activePresetMd = '';
  if (campaign.hasPreset) {
    const activePath = path.join(targetDir, 'preset', 'active.md');
    if (fs.existsSync(activePath)) {
      activePresetMd = fs.readFileSync(activePath, 'utf8');
    }
  }

  const checkCmd = commandExists || ((cli) => Boolean(resolveCliExecutable(cli, { env, platform })));
  const envInfo = detectAgentEnvironment({
    env,
    explicitAgent: agent,
    commandExists: checkCmd,
    platform,
  });

  const hasCustomSpec =
    (Array.isArray(launchArgs) && launchArgs.length > 0) ||
    (launchEnv && typeof launchEnv === 'object' && Object.keys(launchEnv).length > 0);
  if (hasCustomSpec) {
    if (!isValidCustomCliName(envInfo.hostAgent)) {
      throw new Error('Custom --launch-arg/--launch-env requires a concrete CLI name via --agent <cli>.');
    }
    const customLauncher = {
      cli: envInfo.hostAgent,
      args: Array.isArray(launchArgs) ? [...launchArgs] : [],
    };
    if (launchEnv && typeof launchEnv === 'object' && Object.keys(launchEnv).length > 0) {
      customLauncher.env = { ...launchEnv };
    }
    campaign.pureLauncher = customLauncher;
  }

  const purePromptMd = buildPureSystemPromptMd({
    char: campaign.char || 'Character',
    user: campaign.user || '旅人',
    hasPreset: Boolean(campaign.hasPreset),
    hasStatus: Boolean(campaign.hasStatus),
    activePresetMd,
    skillDir: resolvedSkillDir,
  });

  const systemPromptDir = path.join(targetDir, '.tavern-bard');
  const systemPromptPath = path.join(systemPromptDir, 'system-prompt.md');
  fs.mkdirSync(systemPromptDir, { recursive: true });
  fs.writeFileSync(systemPromptPath, purePromptMd, 'utf8');

  const configureClis = [
    ...new Set([
      ...envInfo.installedClis,
      ...(envInfo.supportedPureHost ? [envInfo.hostAgent] : []),
    ]),
  ];

  if (configureClis.includes('opencode')) {
    const opencodeAgentsDir = path.join(targetDir, '.opencode', 'agents');
    fs.mkdirSync(opencodeAgentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(opencodeAgentsDir, 'tavern-bard.md'),
      buildOpencodeAgentMd(purePromptMd),
      'utf8'
    );
    const opencodeJsonPath = path.join(targetDir, 'opencode.json');
    if (!fs.existsSync(opencodeJsonPath)) {
      fs.writeFileSync(
        opencodeJsonPath,
        `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', default_agent: 'tavern-bard' }, null, 2)}\n`,
        'utf8'
      );
    }
  }

  if (configureClis.includes('claude')) {
    const claudeAgentsDir = path.join(targetDir, '.claude', 'agents');
    fs.mkdirSync(claudeAgentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeAgentsDir, 'tavern-bard.md'),
      buildClaudeAgentMd(purePromptMd),
      'utf8'
    );
  }

  if (configureClis.includes('gemini')) {
    upsertGeminiEnv(path.join(targetDir, '.gemini', '.env'));
  }

  if (configureClis.includes('agy')) {
    const agyAgentDir = path.join(targetDir, '.agents', 'agents', 'tavern-bard');
    fs.mkdirSync(agyAgentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agyAgentDir, 'agent.md'),
      buildAgyAgentMd(purePromptMd),
      'utf8'
    );
  }

  const activeCustomLauncher =
    !envInfo.supportedPureHost &&
    campaign.pureLauncher &&
    campaign.pureLauncher.cli &&
    normalizeAgentName(campaign.pureLauncher.cli) === envInfo.hostAgent
      ? campaign.pureLauncher
      : null;
  const effectiveSupportedPureHost = envInfo.supportedPureHost || Boolean(activeCustomLauncher);

  const normalizedExistingPref = campaign.preferredCli ? normalizeAgentName(campaign.preferredCli) : null;
  const isExistingPrefCustom = Boolean(
    normalizedExistingPref &&
      campaign.pureLauncher &&
      campaign.pureLauncher.cli &&
      normalizeAgentName(campaign.pureLauncher.cli) === normalizedExistingPref &&
      checkCmd(normalizedExistingPref)
  );
  const existingPreferred =
    normalizedExistingPref &&
    (envInfo.installedClis.includes(normalizedExistingPref) || isExistingPrefCustom)
      ? normalizedExistingPref
      : null;

  const preferredCli = effectiveSupportedPureHost
    ? envInfo.hostAgent
    : existingPreferred || envInfo.installedClis[0] || campaign.preferredCli || null;

  campaign.pureEnvPrepared = true;
  campaign.preferredCli = preferredCli;
  fs.writeFileSync(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`, 'utf8');

  syncWorkspaceAgentsMd(targetDir, {
    activePresetMd: campaign.hasPreset ? activePresetMd : '',
    skillDir: resolvedSkillDir,
  });

  const isResume = isCampaignResume(targetDir, campaign);
  const launchCommand = 'npx tavern-bard play';
  const nativeLaunchCommand = preferredCli
    ? formatNativeLaunchCommand(preferredCli, {
        isResume,
        pureLauncher: campaign.pureLauncher || null,
        targetDir,
      })
    : null;

  return {
    dir: targetDir,
    systemPromptPath,
    hostAgent: envInfo.hostAgent,
    supportedPureHost: effectiveSupportedPureHost,
    installedClis: envInfo.installedClis,
    preferredCli,
    configuredClis: configureClis,
    pureLauncher: campaign.pureLauncher || null,
    launchCommand,
    nativeLaunchCommand,
    isResume,
  };
}

/**
 * Re-sync `.tavern-bard/system-prompt.md` and any already-present `.opencode`/`.claude` agent files.
 * No-ops cleanly and returns `false` when `.tavern-bard/system-prompt.md` does not exist.
 * @param {string} targetDir
 * @param {{ activePresetMd?: string, skillDir?: string }} [opts]
 * @returns {boolean}
 */
function syncPureEnvironmentFiles(targetDir, { activePresetMd, skillDir } = {}) {
  const resolvedDir = path.resolve(targetDir || process.cwd());
  const systemPromptPath = path.join(resolvedDir, '.tavern-bard', 'system-prompt.md');
  if (!fs.existsSync(systemPromptPath)) {
    return false;
  }

  const campaignPath = path.join(resolvedDir, 'campaign.json');
  const campaign = fs.existsSync(campaignPath) ? readJsonSafe(campaignPath) : null;
  const resolvedSkillDir = extractSkillDirFromWorkspace(resolvedDir, skillDir);

  let presetMd = activePresetMd;
  if (presetMd === undefined) {
    const activePath = path.join(resolvedDir, 'preset', 'active.md');
    if (fs.existsSync(activePath)) {
      presetMd = fs.readFileSync(activePath, 'utf8');
    } else {
      presetMd = '';
    }
  }

  const hasPreset = campaign && typeof campaign === 'object'
    ? Boolean(campaign.hasPreset)
    : Boolean(presetMd && String(presetMd).trim());

  const purePromptMd = buildPureSystemPromptMd({
    char: (campaign && campaign.char) || 'Character',
    user: (campaign && campaign.user) || '旅人',
    hasPreset,
    hasStatus: Boolean(campaign && campaign.hasStatus),
    activePresetMd: hasPreset ? presetMd : '',
    skillDir: resolvedSkillDir,
  });

  fs.writeFileSync(systemPromptPath, purePromptMd, 'utf8');

  const opencodeAgentPath = path.join(resolvedDir, '.opencode', 'agents', 'tavern-bard.md');
  if (fs.existsSync(opencodeAgentPath)) {
    fs.writeFileSync(opencodeAgentPath, buildOpencodeAgentMd(purePromptMd), 'utf8');
  }

  const claudeAgentPath = path.join(resolvedDir, '.claude', 'agents', 'tavern-bard.md');
  if (fs.existsSync(claudeAgentPath)) {
    fs.writeFileSync(claudeAgentPath, buildClaudeAgentMd(purePromptMd), 'utf8');
  }

  const agyAgentPath = path.join(resolvedDir, '.agents', 'agents', 'tavern-bard', 'agent.md');
  if (fs.existsSync(agyAgentPath)) {
    fs.writeFileSync(agyAgentPath, buildAgyAgentMd(purePromptMd), 'utf8');
  }

  return true;
}

module.exports = {
  PURE_ENV_MARKER,
  SUPPORTED_PURE_CLIS,
  normalizeAgentName,
  isCampaignResume,
  buildPureSystemPromptMd,
  resolveCliExecutable,
  detectAgentEnvironment,
  expandPureLauncher,
  formatNativeLaunchCommand,
  setupPureEnvironment,
  syncPureEnvironmentFiles,
};
