#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { loadCard, loadWorldbook, extractCardBundle } = require('./lib/card-loader');
const { preparePresetOnImport, compilePreset } = require('./lib/preset-compiler');

class NonEmptyDirectoryError extends Error {
  /**
   * @param {string} targetDir
   * @param {string[]} entries
   */
  constructor(targetDir, entries) {
    const sample = entries.slice(0, 8).join(', ');
    const more = entries.length > 8 ? ` (+${entries.length - 8} more)` : '';
    super(
      `Target directory is non-empty and lacks campaign.json: "${targetDir}" ` +
        `[${entries.length} entries: ${sample}${more}]. ` +
        `Ask the user whether to initialize in a subdirectory (--dir <subdir>) or re-run with --force.`
    );
    this.name = 'NonEmptyDirectoryError';
    this.code = 'NON_EMPTY_DIRECTORY';
    this.exitCode = 2;
    this.targetDir = targetDir;
    this.entries = entries;
  }
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

function ensureTrailingNewline(text) {
  const str = text == null ? '' : String(text);
  if (!str) return '\n';
  return str.endsWith('\n') ? str : `${str}\n`;
}

function escapeMarkdownTableCell(value) {
  return String(value == null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n+/g, ' ')
    .trim();
}

function fenceTextBlock(content, lang = 'text') {
  const str = content == null ? '' : String(content);
  const matches = str.match(/`+/g) || [];
  const maxRun = matches.reduce((max, run) => Math.max(max, run.length), 2);
  const fence = '`'.repeat(maxRun + 1);
  return `${fence}${lang}\n${str}\n${fence}`;
}

function assertTargetDirectoryReady(targetDir, force) {
  if (!fs.existsSync(targetDir)) {
    return;
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    throw new Error(`Target path exists and is not a directory: "${targetDir}"`);
  }

  const entries = fs.readdirSync(targetDir);
  if (entries.length === 0) return;

  const hasCampaignJson = fs.existsSync(path.join(targetDir, 'campaign.json'));
  if (!hasCampaignJson && !force) {
    throw new NonEmptyDirectoryError(targetDir, entries);
  }
}

function buildWorldbookAlwaysMd(alwaysBody) {
  if (!alwaysBody || !alwaysBody.trim()) {
    return '# 常驻世界书 (Always Active)\n\n（当前无常驻世界书条目。）\n';
  }
  return `# 常驻世界书 (Always Active)\n\n${alwaysBody.trim()}\n`;
}

function buildWorldbookIndexMd(entries) {
  if (!entries || entries.length === 0) {
    return '# 按需世界书索引 (Worldbook Index)\n\n（当前无按需触发词条。）\n';
  }

  const lines = [
    '# 按需世界书索引 (Worldbook Index)',
    '',
    '剧情涉及对应人物、地点或设定关键词时，按需读取 `worldbook/entries/<文件>`。',
    '',
    '| 文件 | 标题 | 触发词 | 字数 |',
    '| :--- | :--- | :--- | ---: |',
  ];

  for (const item of entries) {
    const fileCell = `\`${escapeMarkdownTableCell(item.filename)}\``;
    const titleCell = escapeMarkdownTableCell(item.title);
    const keysCell = item.keys.length > 0 ? escapeMarkdownTableCell(item.keys.join(', ')) : '—';
    lines.push(`| ${fileCell} | ${titleCell} | ${keysCell} | ${item.chars} |`);
  }

  return `${lines.join('\n')}\n`;
}

function buildWorldbookEntryMd(item, isDisabled) {
  const metaParts = [];
  if (isDisabled) metaParts.push('状态：原卡默认关闭（未启用）');
  if (item.keys && item.keys.length > 0) {
    metaParts.push(`${isDisabled ? '原' : ''}触发词：${item.keys.join('、')}`);
  }
  const header = [`# ${item.title}`];
  if (metaParts.length > 0) {
    header.push(`> ${metaParts.join(' | ')}`);
  }
  if (item.content && item.content.trim()) {
    header.push(item.content.trim());
  }
  return `${header.join('\n\n')}\n`;
}

function buildRawStatusCandidatesMd(candidates) {
  const lines = [
    '# Raw Status Bar Candidates (`_raw_candidates.md`)',
    '',
    '> 检测到以下状态栏/MVU候选定义。请由 Agent 审核并转换为根目录 `state.json` 与 `status/rules.md`（若过于复杂可向玩家说明并简化/舍弃），更新 `campaign.json` 中的 `"hasStatus": true`，随后移除本临时文件及 `card/character.md` / `worldbook/always.md` 中要求正文手写状态栏的旧指令。',
    '',
  ];

  candidates.forEach((candidate, idx) => {
    lines.push(`## Candidate ${idx + 1}: ${candidate.title}`);
    lines.push('');
    lines.push(`- **Kind**: \`${candidate.kind}\``);
    lines.push(`- **Source**: \`${candidate.source}\``);
    lines.push('');
    lines.push(fenceTextBlock(candidate.content, 'text'));
    lines.push('');
  });

  return `${lines.join('\n')}`;
}

function buildAgentsMd({ char, user, hasPreset, hasStatus, hasStatusCandidates, skillDir }) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const presetScriptPath = path.join(skillDir, 'scripts', 'preset.js');
  const hudScriptPath = path.join(skillDir, 'scripts', 'hud.js');

  return `# Tavern-Bard Roleplay Campaign: ${char} × ${user}

This working directory is an active \`tavern-bard\` roleplay campaign (\`${char}\` × \`${user}\`).

## Skill Activation

Before continuing or taking any turn, invoke/read the \`tavern-bard\` skill:
- \`${skillMdPath}\`
- Helper CLIs: \`node "${presetScriptPath}"\` | \`node "${hudScriptPath}"\`

## Low-Token Resume Reading List

When starting a new session or recovering from context compression, read ONLY:
1. \`campaign.json\`
2. \`card/character.md\`
3. \`worldbook/always.md\` and \`worldbook/index.md\`
4. ${hasPreset ? '`preset/active.md`' : '`preset/active.md` (if present)'}
5. ${
    hasStatusCandidates && !hasStatus
      ? '`state.json` and `status/rules.md` (if `hasStatus` is `false`, finish converting `status/_raw_candidates.md` first)'
      : '`state.json` and `status/rules.md` (if `hasStatus: true`)'
  }
6. \`memory/summary/facts.md\`, \`memory/summary/arcs.md\`, and the last 3 entries of \`memory/summary/scenes.md\`
7. Tail (last 3–5 turns) of the latest \`memory/full/chapter-XX.md\`

**NEVER** read all of \`memory/full/\` or all of \`worldbook/entries/\` upfront — look up entries via \`worldbook/index.md\` and grep/read ranges only on demand.

## Three Iron Rules

1. **Zero OOC (严禁出戏)**: Never break character or speak as an AI assistant unless the player issues an explicit out-of-character command (e.g., toggle preset, check state, summarize).
2. **Respect User Agency (严禁越界代演)**: Never invent dialogue, inner thoughts, or unstated actions on behalf of \`${user}\`.
3. **Clean Prose (严禁正文污染)**: Output clean literary prose (plus clean Markdown end-of-turn add-ons explicitly required by the active preset). Never emit status codeblocks, \`state.json\` JSON, \`<thinking>\`/\`<think_nya>\` chains, or raw XML wrapper tags (\`<game>\`, \`<options>\`, \`<comment>\`, \`<summary>\`).

## Turn Settlement

After each turn: append the turn to the current \`memory/full/chapter-XX.md\`, update \`state.json\` when \`hasStatus: true\`, and append \`memory/summary/scenes.md\` (plus \`facts.md\` / \`arcs.md\` & next chapter) on scene transitions or every 20 turns.
`;
}

function writeInitialMemoryFiles(targetDir) {
  const summaryDir = path.join(targetDir, 'memory', 'summary');
  const fullDir = path.join(targetDir, 'memory', 'full');
  fs.mkdirSync(summaryDir, { recursive: true });
  fs.mkdirSync(fullDir, { recursive: true });

  const initialFiles = [
    [
      path.join(summaryDir, 'facts.md'),
      '# 核心事实表 (Facts)\n\n## 人物关系与印象\n\n## 关键物品与状态\n\n## 约定与未解伏笔\n',
    ],
    [
      path.join(summaryDir, 'scenes.md'),
      '# 场景摘要 (Scenes)\n\n<!-- 场景自然切换或当前章节满 20 轮时，按时间顺序只追加一段 100-200 字的场景小总结（附章节与轮次，如 chapter-01#Turn1-15）。 -->\n',
    ],
    [
      path.join(summaryDir, 'arcs.md'),
      '# 阶段主线摘要 (Arcs)\n\n<!-- 每当 scenes.md 新增满 5 条未合并的场景小总结时，提炼追加一条 200-300 字阶段主线摘要。 -->\n',
    ],
    [path.join(fullDir, 'chapter-01.md'), '# Chapter 01\n'],
  ];

  for (const [filePath, content] of initialFiles) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }
}

function readExistingCampaign(targetDir) {
  const campaignPath = path.join(targetDir, 'campaign.json');
  if (!fs.existsSync(campaignPath)) return null;
  const parsed = readJsonFile(campaignPath, 'existing campaign.json');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function buildCampaignMeta({
  targetDir,
  existingCampaign,
  char,
  user,
  hasStatusCandidates,
  resolvedCardPath,
  resolvedPresetPath,
}) {
  const hasStateJson = fs.existsSync(path.join(targetDir, 'state.json'));
  const hasPresetSource = fs.existsSync(path.join(targetDir, 'preset', 'source.json'));

  const hasStatus = Boolean(existingCampaign && existingCampaign.hasStatus && hasStateJson);
  const hasPreset = resolvedPresetPath
    ? true
    : Boolean(existingCampaign && existingCampaign.hasPreset && hasPresetSource);
  const presetSource = resolvedPresetPath
    ? path.basename(resolvedPresetPath)
    : hasPreset && existingCampaign
      ? existingCampaign.presetSource ?? null
      : null;

  const currentChapter =
    existingCampaign && Number.isInteger(existingCampaign.currentChapter) && existingCampaign.currentChapter >= 1
      ? existingCampaign.currentChapter
      : 1;
  const currentTurn =
    existingCampaign && Number.isInteger(existingCampaign.currentTurn) && existingCampaign.currentTurn >= 0
      ? existingCampaign.currentTurn
      : 0;
  const createdAt =
    existingCampaign && typeof existingCampaign.createdAt === 'string' && existingCampaign.createdAt.trim()
      ? existingCampaign.createdAt
      : new Date().toISOString();

  return {
    char,
    user,
    hasStatus,
    hasStatusCandidates,
    hasPreset,
    currentChapter,
    currentTurn,
    createdAt,
    cardSource: path.basename(resolvedCardPath),
    presetSource,
  };
}

/**
 * Initialize or refresh a 1-directory-1-campaign tavern-bard workspace.
 * @param {object} opts
 * @param {string} opts.cardPath
 * @param {string} [opts.presetPath]
 * @param {string[]} [opts.worldbookPaths]
 * @param {string} [opts.user]
 * @param {string} [opts.dir]
 * @param {boolean} [opts.force]
 * @param {string} [opts.skillDir]
 * @returns {object}
 */
function initWorkspace(opts) {
  if (!opts || typeof opts !== 'object' || !opts.cardPath) {
    throw new Error('Missing required option: cardPath (--card <path>)');
  }

  const targetDir = path.resolve(opts.dir || process.cwd());
  const skillDir = path.resolve(opts.skillDir || path.resolve(__dirname, '..'));
  const force = Boolean(opts.force);

  // Guard non-empty directory BEFORE modifying anything on disk
  assertTargetDirectoryReady(targetDir, force);
  const existingCampaign = readExistingCampaign(targetDir);

  const resolvedCardPath = path.resolve(opts.cardPath);
  const cardObj = loadCard(resolvedCardPath);

  const worldbookPaths = Array.isArray(opts.worldbookPaths)
    ? opts.worldbookPaths
    : opts.worldbookPath
      ? [opts.worldbookPath]
      : [];
  const extraEntries = [];
  for (const wbPath of worldbookPaths) {
    const resolvedWb = path.resolve(wbPath);
    extraEntries.push(...loadWorldbook(resolvedWb));
  }

  const bundle = extractCardBundle(cardObj, extraEntries, { user: opts.user });
  const vars = { char: bundle.meta.char, user: bundle.meta.user };

  let resolvedPresetPath = null;
  let presetResult = null;
  if (opts.presetPath) {
    resolvedPresetPath = path.resolve(opts.presetPath);
    const presetJson = readJsonFile(resolvedPresetPath, 'preset');
    presetResult = preparePresetOnImport(presetJson, vars);

    const existingOverridesPath = path.join(targetDir, 'preset', 'overrides.json');
    if (fs.existsSync(existingOverridesPath)) {
      const overrides = readJsonFile(existingOverridesPath, 'preset overrides');
      if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
        presetResult.activeMd = compilePreset(presetResult.sourceJson, overrides, vars);
      }
    }
  }

  // Create targetDir only after card/worldbook/preset inputs load cleanly
  fs.mkdirSync(targetDir, { recursive: true });

  // Write card/
  const cardDir = path.join(targetDir, 'card');
  const greetingsDir = path.join(cardDir, 'greetings');
  fs.mkdirSync(greetingsDir, { recursive: true });
  fs.writeFileSync(path.join(cardDir, 'character.md'), ensureTrailingNewline(bundle.characterMd), 'utf8');
  bundle.greetings.forEach((greeting, idx) => {
    const filename = `greeting-${String(idx + 1).padStart(2, '0')}.md`;
    fs.writeFileSync(path.join(greetingsDir, filename), ensureTrailingNewline(greeting), 'utf8');
  });

  // Write worldbook/
  const worldbookDir = path.join(targetDir, 'worldbook');
  const entriesDir = path.join(worldbookDir, 'entries');
  const disabledDir = path.join(worldbookDir, 'disabled');
  fs.mkdirSync(entriesDir, { recursive: true });
  fs.mkdirSync(disabledDir, { recursive: true });
  fs.writeFileSync(path.join(worldbookDir, 'always.md'), buildWorldbookAlwaysMd(bundle.worldbook.always), 'utf8');
  fs.writeFileSync(path.join(worldbookDir, 'index.md'), buildWorldbookIndexMd(bundle.worldbook.entries), 'utf8');
  for (const item of bundle.worldbook.entries) {
    fs.writeFileSync(path.join(entriesDir, item.filename), buildWorldbookEntryMd(item, false), 'utf8');
  }
  for (const item of bundle.worldbook.disabled) {
    fs.writeFileSync(path.join(disabledDir, item.filename), buildWorldbookEntryMd(item, true), 'utf8');
  }

  // Write preset/ only when --preset provided
  if (presetResult) {
    const presetDir = path.join(targetDir, 'preset');
    fs.mkdirSync(presetDir, { recursive: true });
    fs.writeFileSync(
      path.join(presetDir, 'source.json'),
      `${JSON.stringify(presetResult.sourceJson, null, 2)}\n`,
      'utf8'
    );
    fs.writeFileSync(path.join(presetDir, 'active.md'), ensureTrailingNewline(presetResult.activeMd), 'utf8');
  }

  // Write memory/
  writeInitialMemoryFiles(targetDir);

  // Build campaign metadata (preserving live progress on refresh)
  const hasStatusCandidates = bundle.statusCandidates.length > 0;
  const campaign = buildCampaignMeta({
    targetDir,
    existingCampaign,
    char: bundle.meta.char,
    user: bundle.meta.user,
    hasStatusCandidates,
    resolvedCardPath,
    resolvedPresetPath,
  });

  // Write status/_raw_candidates.md ONLY when status candidates exist and state.json is not already active
  if (hasStatusCandidates && !campaign.hasStatus) {
    const statusDir = path.join(targetDir, 'status');
    fs.mkdirSync(statusDir, { recursive: true });
    fs.writeFileSync(
      path.join(statusDir, '_raw_candidates.md'),
      buildRawStatusCandidatesMd(bundle.statusCandidates),
      'utf8'
    );
  }

  // Write campaign.json, AGENTS.md, CLAUDE.md
  fs.writeFileSync(path.join(targetDir, 'campaign.json'), `${JSON.stringify(campaign, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(targetDir, 'AGENTS.md'),
    buildAgentsMd({
      char: campaign.char,
      user: campaign.user,
      hasPreset: campaign.hasPreset,
      hasStatus: campaign.hasStatus,
      hasStatusCandidates,
      skillDir,
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');

  return {
    dir: targetDir,
    skillDir,
    campaign,
    greetingsCount: bundle.greetings.length,
    worldbookStats: {
      hasAlways: Boolean(bundle.worldbook.always && bundle.worldbook.always.trim()),
      entriesCount: bundle.worldbook.entries.length,
      disabledCount: bundle.worldbook.disabled.length,
    },
    autoDisabledPresetEntries: presetResult ? presetResult.autoDisabled : [],
    statusCandidateCount: bundle.statusCandidates.length,
  };
}

function getHelpText() {
  return `Usage:
  node init.js --card <path> [--preset <path>] [--worldbook <path> ...] [--user <name>] [--dir <targetDir>] [--force] [--skill-dir <path>]

Options:
  --card <path>       Path to character card (.png or .json) [required]
  --preset <path>     Optional path to SillyTavern preset (.json)
  --worldbook <path>  Optional standalone worldbook (.json); repeatable
  --user <name>       Player name for {{user}} substitution (default: 旅人)
  --dir <targetDir>   Campaign workspace directory (default: current directory)
  --force             Allow initialization in a non-empty directory without campaign.json
  --skill-dir <path>  Skill installation directory referenced in AGENTS.md
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

function parseInitArgs(argv) {
  const opts = {
    worldbookPaths: [],
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--force') {
      opts.force = true;
      continue;
    }

    const eqIdx = arg.indexOf('=');
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;

    if (flag === '--card') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.cardPath = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--preset') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.presetPath = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--worldbook') {
      if (inlineVal !== undefined) {
        opts.worldbookPaths.push(inlineVal);
      } else {
        const next = argv[i + 1];
        if (next === undefined || isCliFlag(next)) {
          throw new Error('Option --worldbook requires at least one path');
        }
        while (i + 1 < argv.length && !isCliFlag(argv[i + 1])) {
          i += 1;
          opts.worldbookPaths.push(argv[i]);
        }
      }
    } else if (flag === '--user') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.user = taken.value;
      i = taken.nextIndex;
    } else if (flag === '--dir') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.dir = taken.value;
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

function main() {
  let opts;
  try {
    opts = parseInitArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n${getHelpText()}`);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    process.stdout.write(getHelpText());
    return;
  }

  if (!opts.cardPath) {
    process.stderr.write(`Error: --card <path> is required.\n\n${getHelpText()}`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = initWorkspace(opts);
    const { campaign, greetingsCount, worldbookStats, autoDisabledPresetEntries, statusCandidateCount } = result;
    const summaryLines = [
      `Initialized tavern-bard campaign in: ${result.dir}`,
      `  Character: ${campaign.char} | Player: ${campaign.user}`,
      `  Greetings: ${greetingsCount} | Worldbook entries: ${worldbookStats.entriesCount} (disabled: ${worldbookStats.disabledCount}, always: ${worldbookStats.hasAlways ? 'yes' : 'no'})`,
      `  Preset: ${campaign.hasPreset ? `loaded (auto-disabled ${autoDisabledPresetEntries.length})` : 'none'}`,
      `  Status candidates: ${statusCandidateCount}${statusCandidateCount > 0 ? ' -> inspect status/_raw_candidates.md' : ' (no status/ created)'}`,
    ];
    if (autoDisabledPresetEntries.length > 0) {
      summaryLines.push('  Auto-disabled preset entries:');
      for (const item of autoDisabledPresetEntries) {
        summaryLines.push(`    - ${item.name} [${item.reason}]`);
      }
    }
    process.stdout.write(`${summaryLines.join('\n')}\n`);
  } catch (err) {
    if (err && err.exitCode === 2) {
      process.stderr.write(`Warning: ${err.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  NonEmptyDirectoryError,
  initWorkspace,
};
