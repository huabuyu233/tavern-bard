#!/usr/bin/env node
'use strict';

const { setupPureEnvironment } = require('./lib/pure-env');

function getHelpText() {
  return `Usage:
  node env-setup.js [--dir <dir>] [--agent <name>] [--launch-arg <arg> ...] [--launch-env <KEY=VAL> ...] [--sync-file <path> ...] [--skill-dir <path>] [--json]

Options:
  --dir <dir>              Campaign workspace directory (default: current directory)
  --agent <name>           Explicit host agent override (auto, agy, codex, claude, opencode, gemini, <custom-cli>, desktop)
  --launch-arg <arg>       Repeatable launch argument template for a custom CLI (supports {systemPrompt}, {systemPromptAbs}, {prompt})
  --launch-env <KEY=VAL>   Repeatable env var template for a custom CLI (supports {systemPrompt}, {systemPromptAbs}, {prompt})
  --sync-file <path>       Repeatable workspace config/prompt file to keep synced with pure system prompt (preserves YAML frontmatter if present)
  --skill-dir <path>       Skill installation directory referenced in system-prompt.md
  --json                   Output machine-readable JSON result
  --help, -h               Show this help message
`;
}

function isCliFlag(token) {
  return token === '-h' || token.startsWith('--');
}

function takeFlagValue(argv, index, inlineVal, flagName, { allowDash = false } = {}) {
  if (inlineVal !== undefined) {
    if (!inlineVal.trim()) {
      throw new Error(`Option ${flagName} requires a non-empty value`);
    }
    return { value: inlineVal, nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined || (!allowDash && isCliFlag(next)) || !next.trim()) {
    throw new Error(`Option ${flagName} requires a value`);
  }
  return { value: next, nextIndex: index + 1 };
}

function parseEnvSetupArgs(argv) {
  const opts = {
    dir: undefined,
    agent: 'auto',
    skillDir: undefined,
    launchArgs: [],
    launchEnv: {},
    syncFiles: [],
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }

    const eqIdx = arg.indexOf('=');
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;

    if (flag === '--dir') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.dir = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--agent') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.agent = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--skill-dir') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.skillDir = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--launch-arg') {
      const taken = takeFlagValue(argv, i, inlineVal, flag, { allowDash: true });
      opts.launchArgs.push(taken.value);
      i = taken.nextIndex;
    } else if (flag === '--launch-env') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      const sepIdx = taken.value.indexOf('=');
      if (sepIdx <= 0) {
        throw new Error('Option --launch-env requires KEY=VALUE format');
      }
      const envKey = taken.value.slice(0, sepIdx).trim();
      const envVal = taken.value.slice(sepIdx + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) {
        throw new Error(`Invalid environment variable name "${envKey}" in --launch-env`);
      }
      opts.launchEnv[envKey] = envVal;
      i = taken.nextIndex;
    } else if (flag === '--sync-file') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.syncFiles.push(taken.value);
      i = taken.nextIndex;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function formatTextReport(result) {
  const configured = result.configuredClis.length > 0 ? result.configuredClis.join(', ') : 'none';
  const lines = [
    `Prepared pure narrator system-prompt in: ${result.dir}`,
    `  System prompt: ${result.systemPromptPath}`,
    `  Host agent: ${result.hostAgent} (${result.supportedPureHost ? 'pure system-prompt supported' : 'not in built-in presets'})`,
    `  Configured CLIs: ${configured}`,
  ];
  if (result.pureLauncher && Array.isArray(result.pureLauncher.syncFiles) && result.pureLauncher.syncFiles.length > 0) {
    lines.push(`  Synced custom files: ${result.pureLauncher.syncFiles.join(', ')}`);
  }

  if (result.supportedPureHost) {
    lines.push('');
    lines.push('请退出当前会话，使用以下命令重启进入纯净酒馆叙事环境：');
    lines.push(`  ${result.launchCommand}`);
    if (result.nativeLaunchCommand) {
      lines.push(`  或原生启动：${result.nativeLaunchCommand}`);
    }
  } else {
    lines.push('');
    lines.push(`说明：${result.hostAgent} 不在内置预设名单（agy / codex / claude / opencode / gemini）中，已生成 .tavern-bard/system-prompt.md。`);
    lines.push('请联网搜索该 Agent 的官方文档（若本机已安装也可用 <cli> --help 核对），按官方文档写入其自定义主 Agent / 系统提示词配置并保留文件读写命令权限，再用以下命令注册启动入口：');
    lines.push('  node env-setup.js --agent <cli> [--launch-arg <arg> ...] [--launch-env <KEY=VAL> ...] [--sync-file <relative-path> ...]');
    if (result.installedClis.length > 0) {
      lines.push('检测到本机也安装有以下内置支持纯净模式的 CLI，可按需改用：');
      for (const cli of result.installedClis) {
        lines.push(`  - npx tavern-bard play --cli ${cli}`);
      }
    }
    lines.push('若官方文档确认不支持 CLI 或系统提示词替换，也可直接回复："直接在这里开始" 以标准 AGENTS.md 兼容模式游玩。');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  let opts;
  try {
    opts = parseEnvSetupArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n${getHelpText()}`);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    process.stdout.write(getHelpText());
    return;
  }

  try {
    const result = setupPureEnvironment({
      dir: opts.dir,
      agent: opts.agent,
      skillDir: opts.skillDir,
      launchArgs: opts.launchArgs,
      launchEnv: opts.launchEnv,
      syncFiles: opts.syncFiles,
    });
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(formatTextReport(result));
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseEnvSetupArgs,
  formatTextReport,
};
