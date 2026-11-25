'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  replaceMacros,
  stripCommentMacros,
  stripPluginDirectives,
  stripFrontendNoise,
  splitKeywords,
  sanitizeFilename,
} = require('./text-clean');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_USER = '旅人';

const MVU_ENTRY_RE = /\[initvar\]|<\/?initvar>|\[mvu_update\]/i;
const MVU_DIRECTIVE_RE = /mvu_submit_update/i;
const STATUS_DIRECTIVE_RE = /<StatusBlock(?:_format)?>|StatusBlock|<user状态栏>|时间状态栏|状态栏/i;
const STATUS_REGEX_RE = /状态栏|StatusBlock|status[-_]?bar|mvu[-_]?status|<status/i;

function toText(value) {
  return value == null ? '' : String(value);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isNonEmptyValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function cleanProse(text, vars) {
  const withoutComments = stripCommentMacros(text);
  const withoutDirectives = stripPluginDirectives(withoutComments);
  const expanded = replaceMacros(withoutDirectives, vars);
  return stripFrontendNoise(expanded).trim();
}

function cleanStatusText(text, vars) {
  const withoutComments = stripCommentMacros(text);
  const withoutDirectives = stripPluginDirectives(withoutComments);
  const expanded = replaceMacros(withoutDirectives, vars);
  return expanded
    .replace(/<\/?mvu-status(?=\s|\/|>)[^>]*>/gi, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function parsePngTextChunk(type, chunkData, filePath) {
  const nul = chunkData.indexOf(0);
  if (nul === -1) return null;

  const keyword = chunkData.subarray(0, nul).toString('latin1').toLowerCase();
  if (keyword !== 'ccv3' && keyword !== 'chara') return null;

  if (type === 'tEXt') {
    return { keyword, text: chunkData.subarray(nul + 1).toString('latin1') };
  }

  if (type === 'zTXt') {
    if (nul + 1 >= chunkData.length) return null;
    const compMethod = chunkData[nul + 1];
    if (compMethod !== 0) {
      throw new Error(`Unsupported PNG zTXt compression method ${compMethod} in "${filePath}"`);
    }
    const inflated = zlib.inflateSync(chunkData.subarray(nul + 2));
    return { keyword, text: inflated.toString('latin1') };
  }

  // iTXt layout: keyword\0 + compressionFlag(1) + compressionMethod(1) + languageTag\0 + translatedKeyword\0 + text
  if (nul + 2 >= chunkData.length) return null;
  const compFlag = chunkData[nul + 1];
  const langEnd = chunkData.indexOf(0, nul + 3);
  if (langEnd === -1) return null;
  const transEnd = chunkData.indexOf(0, langEnd + 1);
  if (transEnd === -1) return null;

  const textBuf = chunkData.subarray(transEnd + 1);
  if (compFlag === 0) {
    return { keyword, text: textBuf.toString('utf8') };
  }
  if (compFlag === 1) {
    try {
      return { keyword, text: zlib.inflateSync(textBuf).toString('utf8') };
    } catch (err) {
      throw new Error(`Failed to inflate compressed PNG iTXt chunk "${keyword}" in "${filePath}": ${err.message}`);
    }
  }
  throw new Error(`Unsupported PNG iTXt compression flag ${compFlag} in "${filePath}"`);
}

function extractCardJsonFromPng(buf, filePath) {
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`Invalid PNG file (missing PNG signature): "${filePath}"`);
  }

  const found = {};
  let offset = PNG_SIGNATURE.length;

  while (offset < buf.length) {
    if (offset + 8 > buf.length) {
      throw new Error(`Corrupt PNG chunk header at offset ${offset} in "${filePath}"`);
    }
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;

    if (nextOffset > buf.length) {
      throw new Error(`Truncated PNG chunk "${type}" at offset ${offset} in "${filePath}"`);
    }

    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const parsedChunk = parsePngTextChunk(type, buf.subarray(dataStart, dataEnd), filePath);
      if (parsedChunk) {
        found[parsedChunk.keyword] = parsedChunk.text;
      }
    }

    offset = nextOffset;
    if (type === 'IEND') break;
  }

  const chosenKey = found.ccv3 != null ? 'ccv3' : found.chara != null ? 'chara' : null;
  if (!chosenKey) {
    throw new Error(`PNG file does not contain "ccv3" or "chara" card metadata: "${filePath}"`);
  }

  const rawPayload = found[chosenKey].trim();
  const jsonText = rawPayload.startsWith('{')
    ? rawPayload
    : Buffer.from(rawPayload, 'base64').toString('utf8');

  try {
    return JSON.parse(stripBom(jsonText));
  } catch (err) {
    throw new Error(`Invalid JSON inside PNG "${chosenKey}" chunk of "${filePath}": ${err.message}`);
  }
}

function unwrapCardObject(rawObj) {
  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
    throw new Error('Invalid character card: expected a JSON object');
  }

  const root = rawObj;
  const outer = root.raw && typeof root.raw === 'object' && !Array.isArray(root.raw) ? root.raw : root;
  const hasDataWrapper = Boolean(outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data));
  const data = hasDataWrapper ? outer.data : outer;

  const spec = toText(
    outer.spec || root.spec || data.spec || (hasDataWrapper ? 'chara_card_v2' : 'chara_card_v1')
  );

  const mergedExtensions = {
    ...(root.extensions && typeof root.extensions === 'object' ? root.extensions : {}),
    ...(outer.extensions && typeof outer.extensions === 'object' ? outer.extensions : {}),
    ...(data.extensions && typeof data.extensions === 'object' ? data.extensions : {}),
  };
  delete mergedExtensions.tavern_helper;

  const altGreetingsRaw = data.alternate_greetings ?? outer.alternate_greetings ?? root.alternate_greetings;
  const alternate_greetings = Array.isArray(altGreetingsRaw)
    ? altGreetingsRaw.filter((item) => item != null).map((item) => String(item))
    : [];

  const character_book = data.character_book ?? outer.character_book ?? root.character_book ?? null;

  return {
    spec,
    name: toText(data.name ?? outer.name ?? root.name),
    description: toText(data.description ?? outer.description ?? root.description),
    personality: toText(data.personality ?? outer.personality ?? root.personality),
    scenario: toText(data.scenario ?? outer.scenario ?? root.scenario),
    first_mes: toText(data.first_mes ?? outer.first_mes ?? root.first_mes),
    alternate_greetings,
    mes_example: toText(data.mes_example ?? outer.mes_example ?? root.mes_example),
    system_prompt: toText(data.system_prompt ?? outer.system_prompt ?? root.system_prompt),
    post_history_instructions: toText(
      data.post_history_instructions ?? outer.post_history_instructions ?? root.post_history_instructions
    ),
    creator_notes: toText(
      data.creator_notes ??
        outer.creator_notes ??
        outer.creatorcomment ??
        root.creator_notes ??
        root.creatorcomment
    ),
    character_book: character_book && typeof character_book === 'object' ? character_book : null,
    extensions: mergedExtensions,
  };
}

/**
 * Load and unwrap a SillyTavern character card from PNG (tEXt/iTXt) or JSON (V1/V2/V3/DSH).
 * Strips bulky frontend `extensions.tavern_helper` blobs.
 * @param {string} filePath
 * @returns {object}
 */
function loadCard(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('loadCard requires a valid file path');
  }

  const buf = fs.readFileSync(filePath);
  const isPngExt = path.extname(filePath).toLowerCase() === '.png';
  const hasPngSig = buf.length >= PNG_SIGNATURE.length && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);

  let parsed;
  if (isPngExt || hasPngSig) {
    parsed = extractCardJsonFromPng(buf, filePath);
  } else {
    try {
      parsed = JSON.parse(stripBom(buf.toString('utf8')));
    } catch (err) {
      throw new Error(`Failed to parse character card JSON "${filePath}": ${err.message}`);
    }
  }

  return unwrapCardObject(parsed);
}

function resolveInsertionOrder(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeWorldbookEntries(raw, allowBareObjectMap = true) {
  if (raw == null) return [];

  let items;
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'object') {
    if (Array.isArray(raw.entries)) {
      items = raw.entries;
    } else if (raw.entries && typeof raw.entries === 'object') {
      items = Object.values(raw.entries);
    } else if (allowBareObjectMap) {
      items = Object.values(raw);
    } else {
      return null;
    }
  } else {
    return null;
  }

  const normalized = [];
  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const keys = splitKeywords(entry.keys ?? entry.key ?? []);
    const secondaryKeys = splitKeywords(entry.secondary_keys ?? entry.keysecondary ?? []);
    const comment = toText(entry.comment);
    const name = toText(entry.name);
    const title = comment.trim() || name.trim() || toText(entry.title).trim() || keys[0] || 'untitled';

    normalized.push({
      uid: entry.uid ?? entry.id ?? i,
      title,
      comment,
      name,
      keys,
      secondaryKeys,
      content: toText(entry.content),
      enabled: entry.enabled !== false && entry.disable !== true,
      constant: entry.constant === true || entry.strategy === 'constant',
      insertion_order: resolveInsertionOrder(entry.insertion_order ?? entry.order ?? 0),
    });
  }

  return normalized;
}

/**
 * Load a standalone SillyTavern worldbook JSON file (`{ entries: [...] | {...} }` or `[...]`).
 * @param {string} filePath
 * @returns {Array<object>}
 */
function loadWorldbook(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('loadWorldbook requires a valid file path');
  }

  let parsed;
  try {
    parsed = JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    throw new Error(`Failed to parse worldbook JSON "${filePath}": ${err.message}`);
  }

  const entries = normalizeWorldbookEntries(parsed, false);
  if (entries === null) {
    throw new Error(`Invalid worldbook structure in "${filePath}": expected array or { entries }`);
  }
  return entries;
}

function makeUniqueFilename(index, title, usedSet) {
  const prefix = String(index).padStart(3, '0');
  const slug = sanitizeFilename(title, 'entry');
  let filename = `${prefix}-${slug}.md`;
  let suffix = 2;
  while (usedSet.has(filename)) {
    filename = `${prefix}-${slug}-${suffix}.md`;
    suffix += 1;
  }
  usedSet.add(filename);
  return filename;
}

function summarizeRegexCandidate(script) {
  const findRegex = toText(script.findRegex);
  const rawReplace = toText(script.replaceString)
    .replace(/<style(?=\s|>)[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!rawReplace) {
    return `findRegex: ${findRegex}\nreplaceSummary: (strips matched block)`;
  }

  const truncated = rawReplace.length > 1500 ? `${rawReplace.slice(0, 1500)}\n... [truncated]` : rawReplace;
  return `findRegex: ${findRegex}\nreplaceSummary:\n${truncated}`;
}

function detectPromptStatusKind(text) {
  if (MVU_ENTRY_RE.test(text) || MVU_DIRECTIVE_RE.test(text)) return 'mvu';
  if (STATUS_DIRECTIVE_RE.test(text)) return 'frontend-prompt';
  return null;
}

function buildCharacterMarkdown(char, card, macroVars) {
  const sections = [`# ${char}`];
  const fields = [
    ['角色描述 (Description)', card.description],
    ['性格设定 (Personality)', card.personality],
    ['场景背景 (Scenario)', card.scenario],
    ['系统指令 (System Prompt)', card.system_prompt],
    ['历史后指令 (Post-History Instructions)', card.post_history_instructions],
    ['深度提示 (Depth Prompt)', card.extensions.depth_prompt && card.extensions.depth_prompt.prompt],
    ['示例对话 (Example Dialogue)', card.mes_example],
    ['作者备注 (Creator Notes)', card.creator_notes],
  ];

  for (const [heading, rawValue] of fields) {
    const cleaned = cleanProse(rawValue, macroVars);
    if (cleaned) {
      sections.push(`## ${heading}\n\n${cleaned}`);
    }
  }

  return `${sections.join('\n\n')}\n`;
}

/**
 * Normalize a character card and optional extra worldbook entries into clean Markdown,
 * greetings, classified worldbook buckets, and status-bar candidates.
 * @param {object} cardObj
 * @param {Array<object>} [extraEntries=[]]
 * @param {{ user?: string }} [vars={}]
 * @returns {{ meta: { char: string, user: string, spec: string }, characterMd: string, greetings: string[], worldbook: { always: string, entries: Array, disabled: Array }, statusCandidates: Array }}
 */
function extractCardBundle(cardObj, extraEntries = [], vars = {}) {
  const card = unwrapCardObject(cardObj);
  const char = card.name.trim() || 'Character';
  const user = (vars && vars.user ? String(vars.user).trim() : '') || DEFAULT_USER;
  const macroVars = { char, user };

  const characterMd = buildCharacterMarkdown(char, card, macroVars);
  const greetings = [card.first_mes, ...card.alternate_greetings]
    .map((item) => cleanProse(item, macroVars))
    .filter(Boolean);

  const cardBookEntries =
    card.character_book && card.character_book.entries != null
      ? normalizeWorldbookEntries(card.character_book.entries, true) || []
      : [];
  const mergedExtraEntries = normalizeWorldbookEntries(extraEntries, true) || [];
  const allWorldbookEntries = [...cardBookEntries, ...mergedExtraEntries];

  const statusCandidates = [];
  const constantEntries = [];
  const keywordEntries = [];
  const disabledEntries = [];

  for (const entry of allWorldbookEntries) {
    const entrySearchText = `${entry.title}\n${entry.comment}\n${entry.name}\n${entry.content}`;

    if (MVU_ENTRY_RE.test(entrySearchText)) {
      statusCandidates.push({
        kind: 'mvu',
        source: 'worldbook',
        title: entry.title,
        content: cleanStatusText(entry.content, macroVars),
      });
      continue;
    }

    if (!entry.enabled) {
      disabledEntries.push(entry);
      continue;
    }

    const statusKind = detectPromptStatusKind(entrySearchText);
    if (statusKind) {
      statusCandidates.push({
        kind: statusKind,
        source: 'worldbook',
        title: entry.title,
        content: cleanStatusText(entry.content, macroVars),
      });
      continue;
    }

    if (entry.constant) {
      constantEntries.push(entry);
    } else {
      keywordEntries.push(entry);
    }
  }

  constantEntries.sort((a, b) => a.insertion_order - b.insertion_order);
  const alwaysSections = [];
  for (const entry of constantEntries) {
    const cleaned = cleanProse(entry.content, macroVars);
    if (cleaned) {
      alwaysSections.push(`### ${entry.title}\n\n${cleaned}`);
    }
  }
  const always = alwaysSections.join('\n\n');

  const usedEntryFiles = new Set();
  const entries = keywordEntries.map((entry, idx) => {
    const cleaned = cleanProse(entry.content, macroVars);
    return {
      filename: makeUniqueFilename(idx + 1, entry.title, usedEntryFiles),
      title: entry.title,
      keys: entry.keys,
      content: cleaned,
      chars: cleaned.length,
    };
  });

  const usedDisabledFiles = new Set();
  const disabled = disabledEntries.map((entry, idx) => ({
    filename: makeUniqueFilename(idx + 1, entry.title, usedDisabledFiles),
    title: entry.title,
    keys: entry.keys,
    content: cleanProse(entry.content, macroVars),
  }));

  for (const extKey of ['variables', 'dsh_mvu_conversion']) {
    const extVal = card.extensions[extKey];
    if (isNonEmptyValue(extVal)) {
      statusCandidates.push({
        kind: 'mvu',
        source: `extensions.${extKey}`,
        title: `extensions.${extKey}`,
        content: typeof extVal === 'string' ? extVal : JSON.stringify(extVal, null, 2),
      });
    }
  }

  const cardPromptSources = [
    ['card.description', 'Description', card.description],
    ['card.system_prompt', 'System Prompt', card.system_prompt],
    ['card.post_history_instructions', 'Post-History Instructions', card.post_history_instructions],
    [
      'extensions.depth_prompt',
      'Depth Prompt',
      card.extensions.depth_prompt && card.extensions.depth_prompt.prompt,
    ],
    ['card.first_mes', 'First Message', card.first_mes],
    ...card.alternate_greetings.map((greeting, i) => [
      `card.alternate_greetings[${i}]`,
      `Alternate Greeting ${i + 1}`,
      greeting,
    ]),
  ];

  for (const [source, title, rawText] of cardPromptSources) {
    const cleaned = cleanStatusText(rawText, macroVars);
    if (!cleaned) continue;
    const statusKind = detectPromptStatusKind(cleaned);
    if (statusKind) {
      statusCandidates.push({ kind: statusKind, source, title, content: cleaned });
    }
  }

  if (Array.isArray(card.extensions.regex_scripts)) {
    for (const script of card.extensions.regex_scripts) {
      if (!script || typeof script !== 'object' || script.disabled === true) continue;
      const scriptName = toText(script.scriptName).trim();
      const findRegex = toText(script.findRegex);
      if (STATUS_REGEX_RE.test(scriptName) || STATUS_REGEX_RE.test(findRegex)) {
        statusCandidates.push({
          kind: 'frontend-regex',
          source: 'extensions.regex_scripts',
          title: scriptName || toText(script.id).trim() || 'status-regex',
          content: summarizeRegexCandidate(script),
        });
      }
    }
  }

  return {
    meta: { char, user, spec: card.spec },
    characterMd,
    greetings,
    worldbook: {
      always,
      entries,
      disabled,
    },
    statusCandidates,
  };
}

module.exports = {
  loadCard,
  loadWorldbook,
  extractCardBundle,
};
