#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  deploySkill,
  uninstallSkill,
  getDeployStatus,
  getDefaultConfig,
} = require('../scripts/deploy');
const {
  SUPPORTED_PURE_CLIS,
  normalizeAgentName,
  isCampaignResume,
  detectAgentEnvironment,
  setupPureEnvironment,
  syncPureEnvironmentFiles,
  resolveCliExecutable,
  expandPureLauncher,
} = require('../skill/scripts/lib/pure-env');
const { syncWorkspaceAgentsMd } = require('../skill/scripts/lib/workspace-agents');

const SUPPORTED_COMMANDS = new Set(['install', 'uninstall', 'status', 'play']);

const DAY1_INITIAL_PROMPT =
  '请读取角色卡、常驻世界书与开场白，正式输出开场剧情（若存在多个开场白请供我选择）。';
const DAY2_RESUME_PROMPT =
  '请按低Token恢复协议读取存档与近期记录，用两三句话沉浸式回顾上次停下的场景，等待我的下一步行动。';

function getVersion() {
  try {
    return require('../package.json').version;
  } catch {
    return '1.0.0';
  }
}

function getHelpText() {
  return [
    'tavern-bard — Cross-CLI SillyTavern Roleplay Skill Installer & Launcher',
    '',
    'Usage:',
    '  npx tavern-bard [install] [--dry-run]',
    '  npx tavern-bard play [--cli <agy|codex|claude|opencode|gemini|custom>] [--dir <dir>] [--dry-run]',
    '  npx tavern-bard status',
    '  npx tavern-bard uninstall [--dry-run]',
    '',
    'Commands:',
    '  install     Install skill to ~/.agents/skills/tavern-bard and link Claude/Gemini (default)',
    '  play        Launch or resume a campaign in pure narrator system-prompt mode',
    '  status      Show installation and CLI link status',
    '  uninstall   Remove installed skill and CLI links',
    '',
    'Options:',
    '  --cli <name>   CLI to launch for play (built-in: agy, codex, claude, opencode, gemini; or custom pureLauncher)',
    '  --dir <dir>    Campaign directory for play (default: current directory)',
    '  --dry-run      Preview changes or launch arguments without modifying disk',
    '  -v, --version  Show package version',
    '  -h, --help     Show this help message',
  ].join('\n') + '\n';
}

function takeFlagValue(argv, index, inlineVal, flagName) {
  if (inlineVal !== undefined) {
    if (!inlineVal) {
      throw new Error(`Option ${flagName} requires a value`);
    }
    return { value: inlineVal, nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new Error(`Option ${flagName} requires a value`);
  }
  return { value: next, nextIndex: index + 1 };
}

function parseArgs(argv) {
  let command = 'install';
  let commandSet = false;
  let dryRun = false;
  let help = false;
  let version = false;
  let cli = null;
  let dir = process.cwd();
  let dirExplicit = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      version = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    const eqIdx = arg.indexOf('=');
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;

    if (flag === '--cli') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      cli = taken.value;
      i = taken.nextIndex;
      continue;
    }
    if (flag === '--dir') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      dir = taken.value;
      dirExplicit = true;
      i = taken.nextIndex;
      continue;
    }

    if (!arg.startsWith('-') && !commandSet && SUPPORTED_COMMANDS.has(arg)) {
      command = arg;
      commandSet = true;
    } else {
      throw new Error(`Unknown argument: "${arg}"`);
    }
  }

  if (!help && !version && command !== 'play') {
    if (cli !== null) {
      throw new Error('Option --cli is only supported with the "play" command');
    }
    if (dirExplicit) {
      throw new Error('Option --dir is only supported with the "play" command');
    }
  }

  return { command, dryRun, help, version, cli, dir };
}

function normalizeCliName(rawCli) {
  return normalizeAgentName(rawCli);
}

function readCampaignJson(campaignPath, targetDir) {
  let raw;
  try {
    raw = fs.readFileSync(campaignPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read campaign.json in "${targetDir}": ${err.message}`);
  }
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`Invalid JSON in campaign.json in "${targetDir}": ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid campaign.json in "${targetDir}"`);
  }
  return parsed;
}

function needsPureEnvSetup(targetDir, cli) {
  const systemPromptPath = path.join(targetDir, '.tavern-bard', 'system-prompt.md');
  if (!fs.existsSync(systemPromptPath)) {
    return true;
  }
  if (cli === 'opencode') {
    return (
      !fs.existsSync(path.join(targetDir, '.opencode', 'agents', 'tavern-bard.md')) ||
      !fs.existsSync(path.join(targetDir, 'opencode.json'))
    );
  }
  if (cli === 'claude') {
    return !fs.existsSync(path.join(targetDir, '.claude', 'agents', 'tavern-bard.md'));
  }
  if (cli === 'gemini') {
    const geminiEnvPath = path.join(targetDir, '.gemini', '.env');
    if (!fs.existsSync(geminiEnvPath)) {
      return true;
    }
    const content = fs.readFileSync(geminiEnvPath, 'utf8');
    return !/^\s*GEMINI_SYSTEM_MD\s*=\s*\.tavern-bard\/system-prompt\.md\s*$/m.test(content);
  }
  if (cli === 'agy') {
    return !fs.existsSync(path.join(targetDir, '.agents', 'agents', 'tavern-bard', 'agent.md'));
  }
  return false;
}

function buildCliInvocation(cli, initialPrompt, targetDir, env, pureLauncher = null) {
  const cliEnv = { ...env };
  switch (cli) {
    case 'codex':
      return {
        cliArgs: ['-c', 'model_instructions_file=".tavern-bard/system-prompt.md"', initialPrompt],
        cliEnv,
        customEnv: {},
      };
    case 'claude':
      return {
        cliArgs: ['--system-prompt-file', '.tavern-bard/system-prompt.md', initialPrompt],
        cliEnv,
        customEnv: {},
      };
    case 'opencode':
      return {
        cliArgs: [],
        cliEnv,
        customEnv: {},
      };
    case 'gemini':
      return {
        cliArgs: ['-i', initialPrompt],
        cliEnv: {
          ...cliEnv,
          GEMINI_SYSTEM_MD: path.join(targetDir, '.tavern-bard', 'system-prompt.md'),
        },
        customEnv: {},
      };
    case 'agy':
      return {
        cliArgs: ['--agent', 'tavern-bard', '-i', initialPrompt],
        cliEnv,
        customEnv: {},
      };
    default:
      if (pureLauncher && pureLauncher.cli && normalizeCliName(pureLauncher.cli) === cli) {
        return expandPureLauncher(pureLauncher, { initialPrompt, targetDir, env });
      }
      throw new Error(
        `Unsupported CLI "${cli}". Built-in CLIs: ${SUPPORTED_PURE_CLIS.join(', ')}. To register any other CLI, run env-setup.js --agent <cli> --launch-arg ...`
      );
  }
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSpawnCommandAndArgs(resolvedExe, cliArgs, platform) {
  if (platform === 'win32' && resolvedExe.kind === 'ps1') {
    return {
      spawnCommand: 'powershell.exe',
      spawnArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolvedExe.path, ...cliArgs],
    };
  }
  if (platform === 'win32' && (resolvedExe.kind === 'cmd' || resolvedExe.kind === 'bat')) {
    const psParts = [`& ${quotePowerShellLiteral(resolvedExe.path)}`, ...cliArgs.map(quotePowerShellLiteral)];
    return {
      spawnCommand: 'powershell.exe',
      spawnArgs: ['-NoProfile', '-Command', psParts.join(' ')],
    };
  }
  return {
    spawnCommand: resolvedExe.path,
    spawnArgs: cliArgs,
  };
}

/**
 * Prepare pure narrator environment and launch (or preview) a supported CLI
 * for Day-1 start or Day-2+ resume.
 * @param {object} [opts]
 * @returns {object}
 */
function runPlayCommand({
  dir,
  cli,
  dryRun = false,
  env = process.env,
  platform = process.platform,
  commandExists,
  resolveExecutable,
  spawnImpl,
} = {}) {
  const targetDir = path.resolve(dir || process.cwd());

  const normalizedExplicitCli =
    cli !== undefined && cli !== null ? normalizeCliName(cli) : null;

  const campaignPath = path.join(targetDir, 'campaign.json');
  if (!fs.existsSync(campaignPath)) {
    throw new Error(`campaign.json not found in "${targetDir}". Initialize a roleplay campaign first.`);
  }

  let campaign = readCampaignJson(campaignPath, targetDir);

  const isRegisteredCustomCli = (name) =>
    Boolean(
      campaign.pureLauncher &&
        campaign.pureLauncher.cli &&
        normalizeCliName(campaign.pureLauncher.cli) === name
    );
  const isSupportedOrRegistered = (name) =>
    SUPPORTED_PURE_CLIS.includes(name) || isRegisteredCustomCli(name);

  if (normalizedExplicitCli && !isSupportedOrRegistered(normalizedExplicitCli)) {
    throw new Error(
      `Unsupported CLI "${cli}". Built-in CLIs: ${SUPPORTED_PURE_CLIS.join(', ')}. To register any other CLI, run env-setup.js --agent <cli> --launch-arg ...`
    );
  }

  const resolver = resolveExecutable || resolveCliExecutable;
  const checkCliExists = commandExists || ((name) => Boolean(resolver(name, { env, platform })));
  const envInfo = detectAgentEnvironment({ env, platform, commandExists: checkCliExists });

  let resolvedCli;
  if (normalizedExplicitCli) {
    if (!checkCliExists(normalizedExplicitCli)) {
      throw new Error(`CLI "${normalizedExplicitCli}" was not found in PATH.`);
    }
    resolvedCli = normalizedExplicitCli;
  } else {
    const preferred = campaign.preferredCli ? normalizeCliName(campaign.preferredCli) : null;
    const customCli =
      campaign.pureLauncher && campaign.pureLauncher.cli
        ? normalizeCliName(campaign.pureLauncher.cli)
        : null;
    if (preferred && isSupportedOrRegistered(preferred) && checkCliExists(preferred)) {
      resolvedCli = preferred;
    } else if (envInfo.supportedPureHost && checkCliExists(envInfo.hostAgent)) {
      resolvedCli = envInfo.hostAgent;
    } else if (customCli && checkCliExists(customCli)) {
      resolvedCli = customCli;
    } else if (envInfo.installedClis.length > 0) {
      resolvedCli = envInfo.installedClis[0];
    } else {
      throw new Error(
        `No supported pure-mode CLI (${SUPPORTED_PURE_CLIS.join(', ')}) found in PATH (and no custom pureLauncher registered in campaign.json).`
      );
    }
  }

  if (!dryRun) {
    if (needsPureEnvSetup(targetDir, resolvedCli)) {
      setupPureEnvironment({
        dir: targetDir,
        agent: resolvedCli,
        env,
        commandExists: checkCliExists,
        platform,
      });
      campaign = readCampaignJson(campaignPath, targetDir);
    } else {
      let campaignChanged = false;
      if (campaign.preferredCli !== resolvedCli || campaign.pureEnvPrepared !== true) {
        campaign.preferredCli = resolvedCli;
        campaign.pureEnvPrepared = true;
        fs.writeFileSync(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`, 'utf8');
        campaign = readCampaignJson(campaignPath, targetDir);
        campaignChanged = true;
      }
      if (campaignChanged) {
        syncWorkspaceAgentsMd(targetDir);
      }
      syncPureEnvironmentFiles(targetDir);
    }
  }

  const isResume = isCampaignResume(targetDir, campaign);
  const initialPrompt = isResume ? DAY2_RESUME_PROMPT : DAY1_INITIAL_PROMPT;
  const { cliArgs, cliEnv, customEnv } = buildCliInvocation(
    resolvedCli,
    initialPrompt,
    targetDir,
    env,
    campaign.pureLauncher || null
  );

  if (dryRun) {
    return {
      exitCode: 0,
      dryRun: true,
      cli: resolvedCli,
      isResume,
      args: cliArgs,
      prompt: initialPrompt,
      env: cliEnv,
      customEnv,
    };
  }

  if (resolvedCli === 'opencode') {
    process.stdout.write(
      `Starting OpenCode in pure tavern-bard mode (${isResume ? '输入“继续”衔接存档' : '输入“开始”进入开场'})...\n`
    );
  }

  const resolvedExe = resolver(resolvedCli, { env, platform }) || { path: resolvedCli, kind: 'bin' };
  const { spawnCommand, spawnArgs } = buildSpawnCommandAndArgs(resolvedExe, cliArgs, platform);
  const runSpawn = spawnImpl || spawnSync;
  const res = runSpawn(spawnCommand, spawnArgs, {
    cwd: targetDir,
    stdio: 'inherit',
    env: cliEnv,
    shell: false,
  });

  if (res && res.error) {
    throw res.error;
  }

  return {
    exitCode: res && typeof res.status === 'number' ? res.status : 0,
    dryRun: false,
    cli: resolvedCli,
    isResume,
    args: cliArgs,
    prompt: initialPrompt,
    spawnCommand,
    spawnArgs,
    env: cliEnv,
    customEnv,
  };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n${getHelpText()}`);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    process.stdout.write(getHelpText());
    return;
  }
  if (opts.version) {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  const config = getDefaultConfig();

  try {
    if (opts.command === 'play') {
      const res = runPlayCommand({
        dir: opts.dir,
        cli: opts.cli || undefined,
        dryRun: opts.dryRun,
      });
      if (res.dryRun) {
        const lines = [
          '[DRY-RUN] Ready to launch tavern-bard play:',
          `  CLI: ${res.cli}`,
          `  Mode: ${res.isResume ? 'resume (Day-2+)' : 'start (Day-1)'}`,
          `  Args: ${JSON.stringify(res.args)}`,
        ];
        if (res.cli === 'gemini' && res.env && res.env.GEMINI_SYSTEM_MD) {
          lines.push(`  GEMINI_SYSTEM_MD: ${res.env.GEMINI_SYSTEM_MD}`);
        }
        if (res.customEnv && typeof res.customEnv === 'object') {
          for (const [k, v] of Object.entries(res.customEnv)) {
            lines.push(`  Env ${k}: ${v}`);
          }
        }
        process.stdout.write(`${lines.join('\n')}\n`);
      }
      process.exitCode = res.exitCode;
      return;
    }

    if (opts.command === 'status') {
      const st = getDeployStatus(config);
      const lines = [
        'tavern-bard status:',
        `  Skill (${st.agentsSkillDir}): ${st.agentsInstalled ? 'installed' : 'not installed'}`,
        ...st.links.map((l) => `  Link (${l.path}): ${l.exists ? (l.targetMatches ? 'linked' : 'custom/mismatch') : 'not linked'}`),
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
      return;
    }

    if (opts.command === 'uninstall') {
      const res = uninstallSkill({ ...config, dryRun: opts.dryRun });
      const prefix = res.dryRun ? '[DRY-RUN] ' : '';
      process.stdout.write(
        `${prefix}Uninstalled tavern-bard (${res.removed.length} path(s)):\n${
          res.removed.length ? res.removed.map((p) => `  - ${p}`).join('\n') : '  (nothing to remove)'
        }\n`,
      );
      return;
    }

    const res = deploySkill({ ...config, dryRun: opts.dryRun });
    const prefix = res.dryRun ? '[DRY-RUN] ' : '';
    const lines = [
      `${prefix}Installed tavern-bard -> ${path.resolve(config.agentsSkillDir)}`,
      `  Files (${res.copiedFiles.length}): ${res.copiedFiles.join(', ')}`,
      `  Linked (${res.linked.length}): ${res.linked.join(', ')}`,
      '',
      'Ready! Open any empty folder in Claude Code, Codex, OpenCode, Gemini CLI, or Antigravity and say: "开始角色扮演".',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  runPlayCommand,
};

if (require.main === module) {
  main();
}
