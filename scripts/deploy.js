#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Check whether a filesystem entry exists without following broken symlinks/junctions.
 * @param {string} targetPath
 * @returns {boolean}
 */
function pathExistsLstat(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Recursively collect all files under rootDir as sorted POSIX-style relative paths.
 * @param {string} rootDir
 * @param {string} [relPrefix]
 * @returns {string[]}
 */
function collectRelativeFiles(rootDir, relPrefix = '') {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectRelativeFiles(fullPath, relPath));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(relPath);
    }
  }
  return files;
}

/**
 * Deploy the tavern-bard skill directory to the central .agents location,
 * clean legacy paths, and create CLI junctions/symlinks.
 *
 * @param {object} options
 * @param {string} options.repoSkillDir
 * @param {string} options.agentsSkillDir
 * @param {string[]} [options.linkTargets]
 * @param {string[]} [options.legacyPaths]
 * @param {boolean} [options.dryRun]
 * @returns {{ copiedFiles: string[], linked: string[], removedLegacy: string[], dryRun: boolean }}
 */
function deploySkill(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('deploySkill requires an options object.');
  }

  const {
    repoSkillDir,
    agentsSkillDir,
    linkTargets = [],
    legacyPaths = [],
    dryRun = false,
  } = options;

  if (!repoSkillDir || typeof repoSkillDir !== 'string') {
    throw new Error('deploySkill requires a valid repoSkillDir path.');
  }
  if (!agentsSkillDir || typeof agentsSkillDir !== 'string') {
    throw new Error('deploySkill requires a valid agentsSkillDir path.');
  }

  const resolvedRepo = path.resolve(repoSkillDir);
  const resolvedAgents = path.resolve(agentsSkillDir);

  if (resolvedRepo === resolvedAgents) {
    throw new Error(`agentsSkillDir must not match repoSkillDir: "${resolvedAgents}"`);
  }

  if (!fs.existsSync(resolvedRepo) || !fs.statSync(resolvedRepo).isDirectory()) {
    throw new Error(`repoSkillDir does not exist or is not a directory: "${resolvedRepo}"`);
  }

  const skillMdPath = path.join(resolvedRepo, 'SKILL.md');
  if (!fs.existsSync(skillMdPath) || !fs.statSync(skillMdPath).isFile()) {
    throw new Error(`repoSkillDir must contain SKILL.md: "${resolvedRepo}"`);
  }

  const copiedFiles = collectRelativeFiles(resolvedRepo);
  const isDryRun = Boolean(dryRun);

  if (!isDryRun) {
    fs.rmSync(resolvedAgents, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(resolvedAgents), { recursive: true });
    fs.cpSync(resolvedRepo, resolvedAgents, { recursive: true });
  }

  const removedLegacy = [];
  const seenLegacy = new Set();
  for (const legacyPath of legacyPaths) {
    if (!legacyPath) continue;
    const resolvedLegacy = path.resolve(legacyPath);
    if (resolvedLegacy === resolvedRepo || resolvedLegacy === resolvedAgents) {
      throw new Error(`Refusing to remove protected path in legacyPaths: "${resolvedLegacy}"`);
    }
    if (seenLegacy.has(resolvedLegacy)) continue;
    seenLegacy.add(resolvedLegacy);

    if (pathExistsLstat(resolvedLegacy)) {
      if (!isDryRun) {
        fs.rmSync(resolvedLegacy, { recursive: true, force: true });
      }
      removedLegacy.push(resolvedLegacy);
    }
  }

  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  const linked = [];
  const seenLinks = new Set();
  for (const linkPath of linkTargets) {
    if (!linkPath) continue;
    const resolvedLink = path.resolve(linkPath);
    if (resolvedLink === resolvedRepo || resolvedLink === resolvedAgents) {
      throw new Error(`linkTarget must not overwrite source or agentsSkillDir: "${resolvedLink}"`);
    }
    if (seenLinks.has(resolvedLink)) continue;
    seenLinks.add(resolvedLink);

    if (!isDryRun) {
      fs.mkdirSync(path.dirname(resolvedLink), { recursive: true });
      fs.rmSync(resolvedLink, { recursive: true, force: true });
      fs.symlinkSync(resolvedAgents, resolvedLink, symlinkType);
    }
    linked.push(resolvedLink);
  }

  return {
    copiedFiles,
    linked,
    removedLegacy,
    dryRun: isDryRun,
  };
}

/**
 * Resolve default live deployment configuration for the current user's home directory.
 * @param {string} [home]
 */
function getDefaultConfig(home = os.homedir()) {
  return {
    repoSkillDir: path.resolve(__dirname, '..', 'skill'),
    agentsSkillDir: path.join(home, '.agents', 'skills', 'tavern-bard'),
    linkTargets: [
      path.join(home, '.claude', 'skills', 'tavern-bard'),
      path.join(home, '.gemini', 'config', 'skills', 'tavern-bard'),
    ],
    legacyPaths: [
      path.join(home, '.gemini', 'config', 'skills', 'tavern-bard'),
      path.join(home, 'ai_agents_config', '.gemini', 'config', 'skills', 'tavern-bard'),
    ],
  };
}

function getHelpText() {
  return [
    'Usage: node scripts/deploy.js [--dry-run] [--help]',
    '',
    'Deploy skill/ to ~/.agents/skills/tavern-bard, remove legacy copies,',
    'and link ~/.claude/skills/tavern-bard and ~/.gemini/config/skills/tavern-bard.',
    '',
    'Options:',
    '  --dry-run    Preview planned copy, legacy cleanup, and links without modifying disk',
    '  -h, --help   Show this help message',
    '',
  ].join('\n');
}

function parseDeployArgs(argv) {
  const opts = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function formatSummary(config, result) {
  const prefix = result.dryRun ? '[DRY-RUN] ' : '';
  const lines = [
    `${prefix}Deployed tavern-bard skill -> ${config.agentsSkillDir}`,
    `  Files (${result.copiedFiles.length}): ${result.copiedFiles.join(', ')}`,
    `  Legacy removed (${result.removedLegacy.length}): ${
      result.removedLegacy.length > 0 ? result.removedLegacy.join(', ') : 'none'
    }`,
    `  Linked (${result.linked.length}): ${result.linked.join(', ')}`,
  ];
  return `${lines.join('\n')}\n`;
}

function main() {
  let opts;
  try {
    opts = parseDeployArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n${getHelpText()}`);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    process.stdout.write(getHelpText());
    return;
  }

  const config = getDefaultConfig();
  try {
    const result = deploySkill({
      ...config,
      dryRun: opts.dryRun,
    });
    process.stdout.write(formatSummary(config, result));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  deploySkill,
  getDefaultConfig,
  parseDeployArgs,
};
