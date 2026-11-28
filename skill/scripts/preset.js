#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  compilePreset,
  listPresetEntries,
  togglePresetEntries,
  preparePresetOnImport,
  inspectPresetAnomalies,
} = require('./lib/preset-compiler');
const { syncWorkspaceAgentsMd, buildOnboardingAuditMd } = require('./lib/workspace-agents');
const { syncPureEnvironmentFiles } = require('./lib/pure-env');

const DEFAULT_VARS = { char: 'Character', user: '旅人' };

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

function ensureTrailingNewline(text) {
  const str = text == null ? '' : String(text);
  if (!str) return '\n';
  return str.endsWith('\n') ? str : `${str}\n`;
}

/**
 * Load preset/source.json, optional preset/overrides.json, and campaign { char, user } vars.
 * Falls back to `{ char: 'Character', user: '旅人' }` when campaign.json is absent.
 * @param {string} [dir]
 */
function loadPresetContext(dir) {
  const targetDir = path.resolve(dir || process.cwd());
  const presetDir = path.join(targetDir, 'preset');
  const sourcePath = path.join(presetDir, 'source.json');
  const overridesPath = path.join(presetDir, 'overrides.json');
  const activePath = path.join(presetDir, 'active.md');
  const campaignPath = path.join(targetDir, 'campaign.json');

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Preset file not found: "${sourcePath}" (is this a campaign with a preset?)`);
  }

  const sourceJson = readJsonFile(sourcePath, 'preset/source.json');

  let overrides = {};
  if (fs.existsSync(overridesPath)) {
    const parsedOverrides = readJsonFile(overridesPath, 'preset/overrides.json');
    if (!parsedOverrides || typeof parsedOverrides !== 'object' || Array.isArray(parsedOverrides)) {
      throw new Error(`Invalid preset/overrides.json "${overridesPath}": expected a JSON object`);
    }
    overrides = parsedOverrides;
  }

  let vars = { ...DEFAULT_VARS };
  if (fs.existsSync(campaignPath)) {
    const campaign = readJsonFile(campaignPath, 'campaign.json');
    if (campaign && typeof campaign === 'object') {
      vars = {
        char: (campaign.char && String(campaign.char).trim()) || DEFAULT_VARS.char,
        user: (campaign.user && String(campaign.user).trim()) || DEFAULT_VARS.user,
      };
    }
  }

  return {
    dir: targetDir,
    sourcePath,
    overridesPath,
    activePath,
    sourceJson,
    overrides,
    vars,
  };
}

function formatPresetList(entries, overrides = {}) {
  if (!entries || entries.length === 0) {
    return 'No preset entries found.\n';
  }

  const idxWidth = Math.max(2, String(entries[entries.length - 1].index).length);
  const lines = [];
  let enabledCount = 0;
  let markerCount = 0;

  for (const entry of entries) {
    if (entry.enabled) enabledCount += 1;
    if (entry.marker) markerCount += 1;

    const idxCol = String(entry.index).padStart(idxWidth, ' ');
    const mark = entry.enabled ? '[x]' : '[ ]';
    const tags = [];
    if (entry.marker) tags.push('marker');
    if (Object.prototype.hasOwnProperty.call(overrides, entry.identifier)) tags.push('override');
    const tagSuffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    lines.push(`${idxCol}  ${mark}  ${entry.name}${tagSuffix}  (${entry.chars} chars)`);
  }

  lines.push('');
  lines.push(`Total: ${entries.length} entries (${enabledCount} enabled, ${markerCount} marker slots)`);
  return `${lines.join('\n')}\n`;
}

function listPreset({ dir } = {}) {
  const ctx = loadPresetContext(dir);
  const entries = listPresetEntries(ctx.sourceJson);
  return {
    entries,
    overrides: ctx.overrides,
    output: formatPresetList(entries, ctx.overrides),
  };
}

function togglePreset({ dir, enable = [], disable = [] } = {}) {
  const ctx = loadPresetContext(dir);
  const { sourceJson: updatedSourceJson, changed } = togglePresetEntries(ctx.sourceJson, {
    enable,
    disable,
  });
  const activeMd = compilePreset(updatedSourceJson, ctx.overrides, ctx.vars);

  if (changed.length > 0) {
    fs.writeFileSync(ctx.sourcePath, `${JSON.stringify(updatedSourceJson, null, 2)}\n`, 'utf8');
  }
  fs.writeFileSync(ctx.activePath, ensureTrailingNewline(activeMd), 'utf8');
  syncWorkspaceAgentsMd(ctx.dir, { activePresetMd: activeMd });
  syncPureEnvironmentFiles(ctx.dir, { activePresetMd: activeMd });

  return {
    changed,
    sourcePath: ctx.sourcePath,
    activePath: ctx.activePath,
    activeMd,
  };
}

function compileWorkspacePreset({ dir } = {}) {
  const ctx = loadPresetContext(dir);
  const activeMd = compilePreset(ctx.sourceJson, ctx.overrides, ctx.vars);
  fs.writeFileSync(ctx.activePath, ensureTrailingNewline(activeMd), 'utf8');
  syncWorkspaceAgentsMd(ctx.dir, { activePresetMd: activeMd });
  syncPureEnvironmentFiles(ctx.dir, { activePresetMd: activeMd });
  return {
    activePath: ctx.activePath,
    activeMd,
    vars: ctx.vars,
  };
}

function extractSkillDirFromWorkspace(targetDir, explicitSkillDir) {
  if (explicitSkillDir) return path.resolve(explicitSkillDir);
  const agentsPath = path.join(targetDir, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    const content = fs.readFileSync(agentsPath, 'utf8');
    const match = content.match(/-\s*`([^`\n]+?)[/\\]SKILL\.md`/);
    if (match) return match[1];
  }
  return path.resolve(__dirname, '..');
}

/**
 * Load or replace a SillyTavern preset JSON inside an existing campaign directory,
 * generate `_onboarding_audit.md` for AI semantic verification, and sync `AGENTS.md`.
 * @param {{ dir?: string, presetPath: string, keepOverrides?: boolean, skillDir?: string }} opts
 * @returns {object}
 */
function loadPreset({ dir, presetPath, keepOverrides = false, skillDir } = {}) {
  if (!presetPath) {
    throw new Error('Missing preset path: pass <preset.json> or --preset <path>');
  }

  const targetDir = path.resolve(dir || process.cwd());
  const resolvedPresetPath = path.resolve(presetPath);
  const presetJson = readJsonFile(resolvedPresetPath, 'preset');

  const campaignPath = path.join(targetDir, 'campaign.json');
  const hasCampaign = fs.existsSync(campaignPath);
  const campaign = hasCampaign ? readJsonFile(campaignPath, 'campaign.json') : null;
  const vars = {
    char: (campaign && campaign.char && String(campaign.char).trim()) || DEFAULT_VARS.char,
    user: (campaign && campaign.user && String(campaign.user).trim()) || DEFAULT_VARS.user,
  };

  const prepared = preparePresetOnImport(presetJson, vars);
  const presetDir = path.join(targetDir, 'preset');
  const sourcePath = path.join(presetDir, 'source.json');
  const overridesPath = path.join(presetDir, 'overrides.json');
  const activePath = path.join(presetDir, 'active.md');

  fs.mkdirSync(presetDir, { recursive: true });
  fs.writeFileSync(sourcePath, `${JSON.stringify(prepared.sourceJson, null, 2)}\n`, 'utf8');

  let activeMd = prepared.activeMd;
  if (!keepOverrides) {
    if (fs.existsSync(overridesPath)) {
      fs.rmSync(overridesPath, { force: true });
    }
  } else if (fs.existsSync(overridesPath)) {
    const parsedOverrides = readJsonFile(overridesPath, 'preset/overrides.json');
    if (!parsedOverrides || typeof parsedOverrides !== 'object' || Array.isArray(parsedOverrides)) {
      throw new Error(`Invalid preset/overrides.json "${overridesPath}": expected a JSON object`);
    }
    activeMd = compilePreset(prepared.sourceJson, parsedOverrides, vars);
  }

  fs.writeFileSync(activePath, ensureTrailingNewline(activeMd), 'utf8');

  const presetSource = path.basename(resolvedPresetPath);
  const resolvedSkillDir = extractSkillDirFromWorkspace(targetDir, skillDir);

  if (campaign && typeof campaign === 'object' && !Array.isArray(campaign)) {
    campaign.hasPreset = true;
    campaign.presetSource = presetSource;
    campaign.needsOnboardingAudit = true;
    fs.writeFileSync(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`, 'utf8');

    const auditPath = path.join(targetDir, '_onboarding_audit.md');
    const presetAnomalies = inspectPresetAnomalies(prepared.sourceJson, activeMd, prepared.autoDisabled);
    fs.writeFileSync(
      auditPath,
      buildOnboardingAuditMd({
        char: vars.char,
        user: vars.user,
        skillDir: resolvedSkillDir,
        hasPreset: true,
        presetSource,
        presetAnomalies,
        presetOnly: true,
      }),
      'utf8'
    );
  }

  const syncedAgents = syncWorkspaceAgentsMd(targetDir, {
    activePresetMd: activeMd,
    skillDir: resolvedSkillDir,
  });
  const syncedPureEnv = syncPureEnvironmentFiles(targetDir, {
    activePresetMd: activeMd,
    skillDir: resolvedSkillDir,
  });

  return {
    dir: targetDir,
    presetSource,
    sourcePath,
    activePath,
    autoDisabled: prepared.autoDisabled,
    activeMd,
    syncedAgents,
    syncedPureEnv,
  };
}

function getHelpText() {
  return `Usage:
  node preset.js list [--dir <dir>]
  node preset.js toggle [--enable <query>] [--disable <query>] [--dir <dir>]
  node preset.js compile [--dir <dir>]
  node preset.js load <presetPath> [--dir <dir>] [--keep-overrides] [--skill-dir <path>]

Commands:
  list      List all preset entries with index, [x]/[ ] status, name, and chars
  toggle    Enable/disable entries by index, identifier, or name substring (repeatable)
  compile   Recompile preset/active.md from preset/source.json and preset/overrides.json, and sync AGENTS.md
  load      Load or replace preset JSON in an existing campaign, create _onboarding_audit.md, and sync AGENTS.md

Options:
  --enable <query>    Enable matching preset entry (repeatable)
  --disable <query>   Disable matching preset entry (repeatable)
  --preset <path>     Preset JSON path for 'load' (alternative to positional argument)
  --keep-overrides    Keep existing preset/overrides.json when running 'load'
  --dir <dir>         Campaign directory (default: current directory)
  --skill-dir <path>  Skill directory path when syncing AGENTS.md / audit brief
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

function parsePresetArgs(argv) {
  const parsed = {
    command: null,
    target: undefined,
    dir: undefined,
    presetPath: undefined,
    keepOverrides: false,
    skillDir: undefined,
    enable: [],
    disable: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--keep-overrides') {
      parsed.keepOverrides = true;
      continue;
    }

    if (!arg.startsWith('-')) {
      if (!parsed.command) {
        parsed.command = arg;
        continue;
      }
      if (parsed.command === 'load' && !parsed.target) {
        parsed.target = arg;
        continue;
      }
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const eqIdx = arg.indexOf('=');
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;

    if (flag === '--dir') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      parsed.dir = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--preset') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      parsed.presetPath = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--skill-dir') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      parsed.skillDir = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--enable') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      parsed.enable.push(taken.value);
      i = taken.nextIndex;
    } else if (flag === '--disable') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      parsed.disable.push(taken.value);
      i = taken.nextIndex;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function main() {
  let args;
  try {
    args = parsePresetArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n${getHelpText()}`);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    process.stdout.write(getHelpText());
    return;
  }

  if (!args.command || !['list', 'toggle', 'compile', 'load'].includes(args.command)) {
    process.stderr.write(
      `${args.command ? `Unknown command: ${args.command}` : 'Missing command (list | toggle | compile | load)'}\n\n${getHelpText()}`
    );
    process.exitCode = 1;
    return;
  }

  try {
    if (args.command === 'list') {
      const res = listPreset({ dir: args.dir });
      process.stdout.write(res.output);
      return;
    }

    if (args.command === 'toggle') {
      if (args.enable.length === 0 && args.disable.length === 0) {
        throw new Error('toggle requires at least one --enable <query> or --disable <query>');
      }
      const res = togglePreset({ dir: args.dir, enable: args.enable, disable: args.disable });
      if (res.changed.length === 0) {
        process.stdout.write(`No preset entries changed; recompiled ${res.activePath} (${res.activeMd.length} chars).\n`);
      } else {
        const lines = res.changed.map((c) => `  ${c.enabled ? '[x]' : '[ ]'} ${c.name} (${c.identifier})`);
        process.stdout.write(
          `Updated ${res.changed.length} preset entry(s) and recompiled ${res.activePath}:\n${lines.join('\n')}\n`
        );
      }
      return;
    }

    if (args.command === 'load') {
      const res = loadPreset({
        dir: args.dir,
        presetPath: args.presetPath || args.target,
        keepOverrides: args.keepOverrides,
        skillDir: args.skillDir,
      });
      process.stdout.write(
        `Loaded preset ${res.presetSource} -> ${res.activePath} (${res.activeMd.length} chars, auto-disabled ${res.autoDisabled.length}, AGENTS.md synced: ${res.syncedAgents ? 'yes' : 'no'}).\n` +
          (res.autoDisabled.length > 0 ? '  Inspect _onboarding_audit.md to verify no jailbreak entry was auto-disabled, then run init.js --finalize-audit.\n' : '')
      );
      return;
    }

    const res = compileWorkspacePreset({ dir: args.dir });
    process.stdout.write(`Compiled ${res.activePath} (${res.activeMd.length} chars).\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadPresetContext,
  formatPresetList,
  listPreset,
  togglePreset,
  compileWorkspacePreset,
  loadPreset,
};
