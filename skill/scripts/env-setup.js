#!/usr/bin/env node
'use strict';

const { setupPureEnvironment } = require('./lib/pure-env');

function getHelpText() {
  return `Usage:
  node env-setup.js [--dir <dir>] [--agent <name>] [--launch-arg <arg> ...] [--launch-env <KEY=VAL> ...] [--skill-dir <path>] [--json]

Options:
  --dir <dir>              Campaign workspace directory (default: current directory)
  --agent <name>           Explicit host agent override (auto, agy, codex, claude, opencode, gemini, <custom-cli>, desktop)
  --launch-arg <arg>       Repeatable launch argument template for a custom CLI (supports {systemPrompt}, {systemPromptAbs}, {prompt})
  --launch-env <KEY=VAL>   Repeatable env var template for a custom CLI (supports {systemPrompt}, {systemPromptAbs}, {prompt})
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
    `  Host agent: ${result.hostAgent} (${result.supportedPureHost ? 'pure system-prompt supported' : 'no built-in pure launcher matched'})`,
    `  Configured CLIs: ${configured}`,
  ];

  if (result.supportedPureHost) {
    lines.push('');
    lines.push('请退出当前会话，使用以下命令重启进入纯净酒馆叙事环境：');
    lines.push(`  ${result.launchCommand}`);
    if (result.nativeLaunchCommand) {
      lines.push(`  或原生启动：${result.nativeLaunchCommand}`);
    }
  } else {
    lines.push('');
    lines.push(`说明：未能自动匹配宿主（${result.hostAgent}）的内置纯净启动器。`);
    lines.push('若当前或本机其他 CLI Agent 支持官方系统提示词文件/自定义代理参数（指向 .tavern-bard/system-prompt.md），可直接按其官方文档使用，或运行以下命令将其注册到 npx tavern-bard play：');
    lines.push('  node env-setup.js --agent <cli> --launch-arg <flag> --launch-arg "{systemPrompt}" --launch-arg "{prompt}"');
    if (result.installedClis.length > 0) {
      lines.push('检测到本机已安装以下内置支持纯净模式的 CLI，可在对应终端中运行：');
      for (const cli of result.installedClis) {
        lines.push(`  - npx tavern-bard play --cli ${cli}`);
      }
    } else {
      lines.push('未在本机 PATH 中检测到 agy / codex / claude / opencode / gemini CLI。');
    }
    lines.push('若当前宿主确实无 CLI 或无官方系统提示词替换入口（仅桌面端可用），也可直接回复："直接在这里开始" 以标准 AGENTS.md 兼容模式游玩。');
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
