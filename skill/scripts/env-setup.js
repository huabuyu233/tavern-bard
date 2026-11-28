#!/usr/bin/env node
'use strict';

const { setupPureEnvironment } = require('./lib/pure-env');

function getHelpText() {
  return `Usage:
  node env-setup.js [--dir <dir>] [--agent <name>] [--skill-dir <path>] [--json]

Options:
  --dir <dir>         Campaign workspace directory (default: current directory)
  --agent <name>      Explicit host agent override (auto, codex, claude, opencode, gemini, antigravity, cursor, windsurf, desktop)
  --skill-dir <path>  Skill installation directory referenced in system-prompt.md
  --json              Output machine-readable JSON result
  --help, -h          Show this help message
`;
}

function isCliFlag(token) {
  return token === '-h' || token.startsWith('--');
}

function takeFlagValue(argv, index, inlineVal, flagName) {
  if (inlineVal !== undefined) return { value: inlineVal, nextIndex: index };
  const next = argv[index + 1];
  if (next === undefined || isCliFlag(next)) {
    throw new Error(`Option ${flagName} requires a value`);
  }
  return { value: next, nextIndex: index + 1 };
}

function parseEnvSetupArgs(argv) {
  const opts = {
    dir: undefined,
    agent: 'auto',
    skillDir: undefined,
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
    `  Host agent: ${result.hostAgent} (${result.supportedPureHost ? 'pure system-prompt supported' : 'desktop/unsupported host'})`,
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
    lines.push(`说明：很遗憾，当前宿主（${result.hostAgent}）未提供官方系统提示词替换入口，无法在当前宿主中开启纯净酒馆主 Agent 环境。`);
    if (result.installedClis.length > 0) {
      lines.push('检测到本机已安装以下支持纯净模式的 CLI，可在对应终端中运行：');
      for (const cli of result.installedClis) {
        lines.push(`  - npx tavern-bard play --cli ${cli}`);
      }
    } else {
      lines.push('未在本机 PATH 中检测到 codex / claude / opencode / gemini CLI。');
    }
    lines.push('若希望继续在当前宿主游玩普通兼容模式（AGENTS.md 注入），请直接回复："直接在这里开始"。');
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
