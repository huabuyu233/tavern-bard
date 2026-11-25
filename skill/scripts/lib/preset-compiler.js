'use strict';

const {
  replaceMacros,
  stripCommentMacros,
  stripPluginDirectives,
} = require('./text-clean');

const PER_TURN_SUMMARY_NAME_RE = /小总结|高密度剧本场记|场记状态卡|每轮总结|本轮总结/i;
const PER_TURN_SUMMARY_CONTENT_RE = /【高密度剧本场记状态卡】|在\s*<summary>[\s\S]*?<\/summary>\s*标签|每轮[^\n]{0,20}(?:总结|场记)/i;
const SUMMARY_TAG_RE = /<\/?summary\s*>/i;
const DETAILS_TAG_RE = /<details\b/i;

const STATUS_BAR_KEYWORD_RE =
  /SC状态指令|SC输出格式|MVU强制|StatusBlock|<status_?block|<user状态栏>|时间状态栏|mvu_submit_update|<mvu_update|\[mvu_update\]/i;
const STATUS_BAR_PROMPT_RE =
  /(?:正文末尾|回复末尾|每轮|每次回复|必须|输出|附带|生成)[^\n]{0,30}(?:状态栏|属性面板|状态面板)/i;

const WRAPPER_TAG_RE =
  /<\/?(?:game|game_content|content|prose|story|maintext|output|response)\s*>/i;

const THINK_TAG_RE = /<\/?(?:thinking|think_nya|think)\s*>/i;
const THINK_MACRO_RE = /registerThinkingStep|deepthink|大思考步骤/i;

const ORPHAN_SLOT_TAG_LINE_RE = /^[ \t]*<\/?(?:\{\{(?:char|user)\}\}|BOT|USER)\s*>[ \t]*$/gmi;
const FAKE_TOOL_SENTENCE_RE =
  /(?:^|(?<=[。！？!?\n~～]))[ \t]*[^。！？!?\n~～]*(?:soliumbra_reply|(?:使用\s*)?`?reply`?\s*工具)[^。！？!?\n~～]*[。！？!?~～]?/gi;
const THINK_SENTENCE_RE =
  /(?:^|(?<=[。！？!?\n~～]))[ \t]*[^。！？!?\n~～]*`?<\/?(?:think_nya|thinking)\s*>`?[^。！？!?\n~～]*[。！？!?~～]?/gi;
const THINK_INLINE_TAG_RE = /`?\s*<\/?(?:think_nya|thinking)\s*>\s*`?/gi;

const PURE_SEPARATOR_RE = /^[\s=\-_*~·#│|]+$/;
const DECORATIVE_BANNER_RE = /^(?:={2,}|-{2,}|\*{2,}|~{2,})[^=\-\n]{0,40}(?:={2,}|-{2,}|\*{2,}|~{2,})$/;
const SINGLE_ORPHAN_XML_TAG_RE = /^<\/?[a-zA-Z_][\w:-]*\s*\/?>$/;

function toText(value) {
  return value == null ? '' : String(value);
}

function assertPresetObject(presetJson) {
  if (!presetJson || typeof presetJson !== 'object' || Array.isArray(presetJson)) {
    throw new Error('Invalid preset: expected a JSON object');
  }
}

function selectPromptOrderGroup(presetJson) {
  assertPresetObject(presetJson);
  if (!Array.isArray(presetJson.prompt_order)) return null;

  const validGroups = presetJson.prompt_order.filter(
    (group) => group && typeof group === 'object' && Array.isArray(group.order)
  );
  if (validGroups.length === 0) return null;

  return (
    validGroups.find((group) => group.character_id === 100001) ||
    validGroups.find((group) => String(group.character_id) === '100001') ||
    validGroups[validGroups.length - 1]
  );
}

function buildPromptMap(prompts) {
  const map = new Map();
  if (!Array.isArray(prompts)) return map;

  for (const prompt of prompts) {
    if (!prompt || typeof prompt !== 'object' || prompt.identifier == null) continue;
    map.set(String(prompt.identifier), prompt);
  }
  return map;
}

/**
 * Resolve SillyTavern preset prompt ordering and effective enabled flags.
 * Prefers `character_id === 100001`, falls back to the last `prompt_order` group,
 * and finally falls back to `prompts[].enabled` when `prompt_order` is absent/empty.
 * @param {object} presetJson
 * @returns {Array<{ identifier: string, enabled: boolean, prompt: object }>}
 */
function resolvePromptOrder(presetJson) {
  const group = selectPromptOrderGroup(presetJson);
  const prompts = Array.isArray(presetJson.prompts) ? presetJson.prompts : [];

  if (!group) {
    return prompts
      .filter((prompt) => prompt && typeof prompt === 'object' && prompt.identifier != null)
      .map((prompt) => ({
        identifier: String(prompt.identifier),
        enabled: prompt.enabled !== false,
        prompt,
      }));
  }

  const promptMap = buildPromptMap(prompts);
  const resolved = [];

  for (const item of group.order) {
    if (!item || typeof item !== 'object' || item.identifier == null) continue;
    const identifier = String(item.identifier);
    const prompt = promptMap.get(identifier);
    if (!prompt) continue;

    const enabled = item.enabled !== undefined ? Boolean(item.enabled) : prompt.enabled !== false;
    resolved.push({ identifier, enabled, prompt });
  }

  return resolved;
}

function stripFakeToolAndThinkClauses(text) {
  let out = toText(text);
  if (!out) return '';

  out = out.replace(FAKE_TOOL_SENTENCE_RE, '');
  out = out.replace(THINK_SENTENCE_RE, '');
  out = out.replace(THINK_INLINE_TAG_RE, '');
  return out;
}

function stripBalancedCommentMacros(text) {
  const str = toText(text);
  if (!str || !str.includes('{{//')) return stripCommentMacros(str);

  let out = '';
  let i = 0;
  while (i < str.length) {
    const start = str.indexOf('{{//', i);
    if (start === -1) {
      out += str.slice(i);
      break;
    }
    out += str.slice(i, start);

    let depth = 1;
    let pos = start + 4;
    let closed = false;
    while (pos < str.length) {
      if (str[pos] === '{' && str[pos + 1] === '{') {
        depth += 1;
        pos += 2;
      } else if (str[pos] === '}' && str[pos + 1] === '}') {
        depth -= 1;
        pos += 2;
        if (depth === 0) {
          closed = true;
          break;
        }
      } else {
        pos += 1;
      }
    }

    if (closed) {
      i = pos;
    } else {
      const fallbackEnd = str.indexOf('}}', start + 4);
      if (fallbackEnd !== -1) {
        i = fallbackEnd + 2;
      } else {
        out += str.slice(start);
        break;
      }
    }
  }

  return stripCommentMacros(out);
}

function classifyAutoDisableReason(entry) {
  const prompt = entry.prompt || {};
  const name = toText(prompt.name || entry.identifier);
  const raw = toText(prompt.content);
  const noComments = stripBalancedCommentMacros(raw);
  const cleanBody = stripPluginDirectives(noComments).trim();

  // 1. Per-turn summary cards (<summary></summary>, 📏小总结) — skip HTML <details><summary>
  const hasDetailsAccordion = DETAILS_TAG_RE.test(cleanBody) && !/<summary>\s*<\/summary>/i.test(cleanBody);
  if (
    (!hasDetailsAccordion && SUMMARY_TAG_RE.test(cleanBody)) ||
    PER_TURN_SUMMARY_NAME_RE.test(name) ||
    PER_TURN_SUMMARY_CONTENT_RE.test(cleanBody)
  ) {
    return 'per-turn-summary';
  }

  // 2. Frontend status bar blocks
  if (
    STATUS_BAR_KEYWORD_RE.test(name) ||
    STATUS_BAR_KEYWORD_RE.test(cleanBody) ||
    STATUS_BAR_PROMPT_RE.test(cleanBody)
  ) {
    return 'frontend-status-bar';
  }

  // 3. Frontend prose wrapper tags (<game></game>, etc.)
  if (WRAPPER_TAG_RE.test(cleanBody)) {
    const withoutWrapperLines = cleanBody
      .split(/\r?\n/)
      .filter((line) => !WRAPPER_TAG_RE.test(line))
      .join('\n')
      .trim();
    if (!withoutWrapperLines || cleanBody.length <= 240) {
      return 'frontend-wrapper-tag';
    }
  }

  // 4. Standalone thinking-tag entries (not jailbreak persona dialogue)
  if (!cleanBody && THINK_MACRO_RE.test(`${name}\n${raw}`)) {
    return 'standalone-thinking-tag';
  }

  if (THINK_TAG_RE.test(cleanBody)) {
    const speakerLines = cleanBody.match(/^\|[^|\n]+\|/gm) || [];
    const remainder = stripFakeToolAndThinkClauses(cleanBody).trim();
    const isJailbreakPersona = speakerLines.length >= 2 && remainder.length >= 80;
    const opensWithThinkingDirective = /^(?:在[^\n]*?(?:前|之前)[^\n]*)?<\/?(?:thinking|think_nya|think)\s*>|^[^\n]{0,40}在\s*<(?:thinking|think_nya|think)\s*>/i.test(
      cleanBody
    );

    if (!isJailbreakPersona && (remainder.length < 50 || opensWithThinkingDirective)) {
      return 'standalone-thinking-tag';
    }
  }

  return null;
}

function rewriteXmlFormatRules(text) {
  let out = toText(text);
  if (!out) return '';

  // Rewrite <options>...</options> blocks into clean Markdown bullet lists
  out = out.replace(/<options\s*>([\s\S]*?)<\/options\s*>/gi, (_, inner) => {
    const items = [];
    const itemRe = /<option\s*>([\s\S]*?)<\/option\s*>/gi;
    let match;
    while ((match = itemRe.exec(inner)) !== null) {
      const cleaned = match[1].trim();
      if (cleaned) items.push(`- ${cleaned}`);
    }
    if (items.length > 0) {
      return `---\n**行动选项**\n${items.join('\n')}`;
    }
    const fallback = inner.replace(/<\/?option\s*>/gi, '').trim();
    return fallback ? `---\n**行动选项**\n${fallback}` : '';
  });

  // Rewrite standalone <option> / <options> instructions
  out = out.replace(
    /^[ \t]*([-*]\s*)?每条选项包裹于\s*<\/?option\s*>\s*标签中[。.]?[ \t]*$/gmi,
    '$1使用纯 Markdown 分隔线与无序列表呈现（不要输出 XML 标签）'
  );
  out = out.replace(
    /(?:使用|用|包裹于|放在)\s*<\/?options?\s*>(?:\s*<\/options?\s*>)?\s*(?:标签)?[里内中]?/gi,
    '使用纯 Markdown 列表'
  );
  out = out.replace(/^[ \t]*格式[:：][ \t]*\n(?=---\n\*\*行动选项\*\*)/gmi, '格式（纯 Markdown，勿使用 XML 标签）：\n');
  out = out.replace(/<\/?options?\s*>/gi, '');

  // Rewrite <comment>...</comment> instructions into Markdown blockquote rules
  out = out.replace(/<comment\s*>([^<\n]+)<\/comment\s*>/gi, (_, inner) => `> 留言：${inner.trim()}`);
  out = out.replace(
    /(?:在|用|使用)?\s*<comment\s*>(?:\s*<\/comment\s*>)?\s*(?:标签)?[里内中]?/gi,
    '在正文末尾用分隔线和 Markdown 引用块（`> 留言：...`）'
  );
  out = out.replace(/<\/?comment\s*>/gi, '');

  return out;
}

function isDroppableContent(text) {
  const trimmed = toText(text).trim();
  if (!trimmed) return true;
  if (PURE_SEPARATOR_RE.test(trimmed)) return true;

  const nonEmptyLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length === 0) return true;
  if (nonEmptyLines.every((line) => PURE_SEPARATOR_RE.test(line) || DECORATIVE_BANNER_RE.test(line))) {
    return true;
  }
  if (nonEmptyLines.every((line) => SINGLE_ORPHAN_XML_TAG_RE.test(line))) {
    return true;
  }
  return false;
}

function sanitizePromptContent(rawContent, vars) {
  let text = stripBalancedCommentMacros(rawContent);
  text = stripPluginDirectives(text);
  text = text.replace(ORPHAN_SLOT_TAG_LINE_RE, '');
  text = stripFakeToolAndThinkClauses(text);
  text = rewriteXmlFormatRules(text);
  text = replaceMacros(text, vars);
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return isDroppableContent(text) ? '' : text;
}

function sanitizeHeadingName(name, vars) {
  const expanded = replaceMacros(toText(name), vars);
  return expanded.replace(/\s+/g, ' ').trim();
}

function setEntryEnabledState(sourceJson, group, identifier, enabled) {
  if (group && Array.isArray(group.order)) {
    for (const item of group.order) {
      if (item && String(item.identifier) === identifier) {
        item.enabled = enabled;
      }
    }
  }
  if (Array.isArray(sourceJson.prompts)) {
    for (const prompt of sourceJson.prompts) {
      if (prompt && String(prompt.identifier) === identifier) {
        prompt.enabled = enabled;
      }
    }
  }
}

/**
 * Compile enabled preset entries (plus optional `overrides` keyed by identifier)
 * into clean Markdown instructions grouped into core rules and depth<=2 hard constraints.
 * @param {object} presetJson
 * @param {Record<string, string>} [overrides={}]
 * @param {{ char?: string, user?: string }} [vars={}]
 * @returns {string}
 */
function compilePreset(presetJson, overrides = {}, vars = {}) {
  const resolved = resolvePromptOrder(presetJson);
  const safeOverrides = overrides && typeof overrides === 'object' ? overrides : {};
  const coreSections = [];
  const hardConstraintSections = [];

  for (const entry of resolved) {
    if (!entry.enabled) continue;
    const prompt = entry.prompt || {};
    if (prompt.marker === true) continue;

    const hasOverride =
      Object.prototype.hasOwnProperty.call(safeOverrides, entry.identifier) &&
      typeof safeOverrides[entry.identifier] === 'string';
    const rawContent = hasOverride ? safeOverrides[entry.identifier] : prompt.content;
    const cleaned = sanitizePromptContent(rawContent, vars);
    if (!cleaned) continue;

    const heading = sanitizeHeadingName(prompt.name || entry.identifier, vars) || entry.identifier;
    const section = `### ${heading}\n\n${cleaned}`;

    const injPos = prompt.injection_position;
    const depth = prompt.injection_depth == null ? Infinity : Number(prompt.injection_depth);
    if (injPos === 1 && Number.isFinite(depth) && depth <= 2) {
      hardConstraintSections.push(section);
    } else {
      coreSections.push(section);
    }
  }

  const parts = ['# 当前激活预设指令'];
  if (coreSections.length > 0) {
    parts.push(`## 核心文风与扮演指令\n\n${coreSections.join('\n\n')}`);
  }
  if (hardConstraintSections.length > 0) {
    parts.push(`## 每轮落笔前硬约束\n\n${hardConstraintSections.join('\n\n')}`);
  }
  if (coreSections.length === 0 && hardConstraintSections.length === 0) {
    parts.push('（当前无启用的预设条目）');
  }

  return `${parts.join('\n\n')}\n`;
}

/**
 * Prepare a preset on import: deep-clone, auto-disable CLI-conflicting entries,
 * and compile `active.md` while keeping jailbreak persona & enabled add-ons intact.
 * @param {object} presetJson
 * @param {{ char?: string, user?: string }} [vars={}]
 * @returns {{ sourceJson: object, autoDisabled: Array<{ identifier: string, name: string, reason: string }>, activeMd: string }}
 */
function preparePresetOnImport(presetJson, vars = {}) {
  assertPresetObject(presetJson);
  const sourceJson = structuredClone(presetJson);
  const group = selectPromptOrderGroup(sourceJson);
  const resolved = resolvePromptOrder(sourceJson);
  const autoDisabled = [];

  for (const entry of resolved) {
    if (!entry.enabled) continue;
    const prompt = entry.prompt || {};
    if (prompt.marker === true) continue;

    const reason = classifyAutoDisableReason(entry);
    if (!reason) continue;

    setEntryEnabledState(sourceJson, group, entry.identifier, false);
    autoDisabled.push({
      identifier: entry.identifier,
      name: toText(prompt.name || entry.identifier),
      reason,
    });
  }

  const activeMd = compilePreset(sourceJson, {}, vars);
  return { sourceJson, autoDisabled, activeMd };
}

/**
 * List resolved preset entries with 1-based display indices and character counts.
 * @param {object} presetJson
 * @returns {Array<{ index: number, identifier: string, name: string, enabled: boolean, marker: boolean, chars: number }>}
 */
function listPresetEntries(presetJson) {
  const resolved = resolvePromptOrder(presetJson);
  return resolved.map((entry, idx) => {
    const prompt = entry.prompt || {};
    const content = typeof prompt.content === 'string' ? prompt.content : '';
    return {
      index: idx + 1,
      identifier: entry.identifier,
      name: toText(prompt.name || entry.identifier),
      enabled: Boolean(entry.enabled),
      marker: Boolean(prompt.marker),
      chars: content.length,
    };
  });
}

function findMatchingEntries(entries, query) {
  const q = toText(query).trim();
  if (!q) return [];

  if (/^\d+$/.test(q)) {
    const index = Number(q);
    const byIndex = entries.filter((entry) => entry.index === index);
    if (byIndex.length > 0) return byIndex;
  }

  const byId = entries.filter((entry) => entry.identifier === q);
  if (byId.length > 0) return byId;

  const qLower = q.toLowerCase();
  const byExactName = entries.filter((entry) => entry.name.toLowerCase() === qLower);
  if (byExactName.length > 0) return byExactName;

  return entries.filter((entry) => entry.name.toLowerCase().includes(qLower));
}

function normalizeQueryList(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((item) => toText(item).trim()).filter(Boolean);
}

/**
 * Toggle preset entries by 1-based index, exact identifier, or case-insensitive name substring.
 * Pure: deep-clones input and mirrors changes across both `prompt_order` and `prompts[]`.
 * @param {object} presetJson
 * @param {{ enable?: string | string[], disable?: string | string[] }} [options={}]
 * @returns {{ sourceJson: object, changed: Array<{ identifier: string, name: string, enabled: boolean }> }}
 */
function togglePresetEntries(presetJson, options = {}) {
  assertPresetObject(presetJson);
  const sourceJson = structuredClone(presetJson);
  const group = selectPromptOrderGroup(sourceJson);
  const entries = listPresetEntries(sourceJson);

  const safeOpts = options && typeof options === 'object' ? options : {};
  const enableQueries = normalizeQueryList(safeOpts.enable);
  const disableQueries = normalizeQueryList(safeOpts.disable);

  const initialEnabled = new Map(entries.map((e) => [e.identifier, e.enabled]));
  const changedOrder = [];

  const applyQueries = (queries, targetEnabled) => {
    for (const query of queries) {
      for (const entry of findMatchingEntries(entries, query)) {
        entry.enabled = targetEnabled;
        setEntryEnabledState(sourceJson, group, entry.identifier, targetEnabled);
        if (!changedOrder.includes(entry.identifier)) {
          changedOrder.push(entry.identifier);
        }
      }
    }
  };

  applyQueries(enableQueries, true);
  applyQueries(disableQueries, false);

  const entryById = new Map(entries.map((e) => [e.identifier, e]));
  const changed = [];
  for (const identifier of changedOrder) {
    const entry = entryById.get(identifier);
    if (initialEnabled.get(identifier) !== entry.enabled) {
      changed.push({
        identifier: entry.identifier,
        name: entry.name,
        enabled: entry.enabled,
      });
    }
  }

  return { sourceJson, changed };
}

module.exports = {
  resolvePromptOrder,
  preparePresetOnImport,
  compilePreset,
  listPresetEntries,
  togglePresetEntries,
};
