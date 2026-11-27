#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  deploySkill,
  uninstallSkill,
  getDeployStatus,
  getDefaultConfig,
} = require('../scripts/deploy');

function getVersion() {
  try {
    return require('../package.json').version;
  } catch {
    return '1.0.0';
  }
}

function getHelpText() {
  return [
    'tavern-bard — Cross-CLI SillyTavern Roleplay Skill Installer',
    '',
    'Usage:',
    '  npx tavern-bard [install] [--dry-run]',
    '  npx tavern-bard status',
    '  npx tavern-bard uninstall [--dry-run]',
    '',
    'Commands:',
    '  install     Install skill to ~/.agents/skills/tavern-bard and link Claude/Gemini (default)',
    '  status      Show installation and CLI link status',
    '  uninstall   Remove installed skill and CLI links',
    '',
    'Options:',
    '  --dry-run   Preview changes without modifying disk',
    '  -v, --version  Show package version',
    '  -h, --help     Show this help message',
  ].join('\n') + '\n';
}

function parseArgs(argv) {
  let command = 'install';
  let commandSet = false;
  let dryRun = false;
  let help = false;
  let version = false;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-v' || arg === '--version') {
      version = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('-') && !commandSet && (arg === 'install' || arg === 'uninstall' || arg === 'status')) {
      command = arg;
      commandSet = true;
    } else {
      throw new Error(`Unknown argument: "${arg}"`);
    }
  }

  return { command, dryRun, help, version };
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
    if (opts.command === 'status') {
      const st = getDeployStatus(config);
      const lines = [
        `tavern-bard status:`,
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
      'Ready! Open any empty folder in Claude Code, Codex, Gemini CLI, or Antigravity and say: "开始角色扮演".',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
