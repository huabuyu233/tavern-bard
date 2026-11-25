#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { compilePreset, listPresetEntries, togglePresetEntries } = require('./lib/preset-compiler');

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

  fs.writeFileSync(ctx.sourcePath, `${JSON.stringify(updatedSourceJson, null, 2)}\n`, 'utf8');
  fs.writeFileSync(ctx.activePath, ensureTrailingNewline(activeMd), 'utf8');

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
  return {
    activePath: ctx.activePath,
    activeMd,
    vars: ctx.vars,
  };
}

function getHelpText() {
  return `Usage:
  node preset.js list [--dir <dir>]
  node preset.js toggle [--enable <query>] [--disable <query>] [--dir <dir>]
  node preset.js compile [--dir <dir>]

Commands:
  list      List all preset entries with index, [x]/[ ] status, name, and chars
  toggle    Enable/disable entries by index, identifier, or name substring (repeatable)
  compile   Recompile preset/active.md from preset/source.json and preset/overrides.json

Options:
  --enable <query>    Enable matching preset entry (repeatable)
  --disable <query>   Disable matching preset entry (repeatable)
  --dir <dir>         Campaign directory (default: current directory)
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
    dir: undefined,
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

    if (!arg.startsWith('-')) {
      if (!parsed.command) {
        parsed.command = arg;
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

  if (!args.command || !['list', 'toggle', 'compile'].includes(args.command)) {
    process.stderr.write(
      `${args.command ? `Unknown command: ${args.command}` : 'Missing command (list | toggle | compile)'}\n\n${getHelpText()}`
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
};
