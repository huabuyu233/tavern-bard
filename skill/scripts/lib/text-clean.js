'use strict';

/**
 * Convert nullable input to string.
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
  return value == null ? '' : String(value);
}

/**
 * Expand SillyTavern character, user, newline, and trim macros.
 * Unknown macros are left intact.
 * @param {string} text
 * @param {{ char?: string, user?: string }} [vars]
 * @returns {string}
 */
function replaceMacros(text, vars = {}) {
  const str = toText(text);
  if (!str) return '';

  const safeVars = vars && typeof vars === 'object' ? vars : {};
  const charName = safeVars.char == null ? '' : String(safeVars.char);
  const userName = safeVars.user == null ? '' : String(safeVars.user);
  const hasTrim = /\{\{trim\}\}/i.test(str);

  const replaced = str
    .replace(/\{\{char\}\}|<BOT>/gi, () => charName)
    .replace(/\{\{user\}\}|<USER>/gi, () => userName)
    .replace(/\{\{newline\}\}/gi, '\n')
    .replace(/\{\{trim\}\}/gi, '');

  return hasTrim ? replaced.trim() : replaced;
}

/**
 * Strip single-line and multi-line SillyTavern {{// ...}} comment macros.
 * @param {string} text
 * @returns {string}
 */
function stripCommentMacros(text) {
  const str = toText(text);
  return str ? str.replace(/\{\{\/\/[\s\S]*?\}\}/g, '') : '';
}

/**
 * Strip catgodml/SPreset directive blocks and merge/sep/tool tokens.
 * @param {string} text
 * @returns {string}
 */
function stripPluginDirectives(text) {
  const str = toText(text);
  return str
    ? str.replace(/<<<\|[\s\S]*?>>>|<\|sep\|>|<\|merge\|>|<run_tool_replacement>/g, '')
    : '';
}

/**
 * Strip SillyTavern frontend HTML/CSS/script noise while preserving prose.
 * @param {string} text
 * @returns {string}
 */
function stripFrontendNoise(text) {
  const str = toText(text);
  if (!str) return '';

  return str
    .replace(/<style(?=\s|>)[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script(?=\s|>)[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:mvu-status|start|div|span)(?=\s|\/|>)[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');
}

/**
 * Split keyword strings or arrays on commas, semicolons, and newlines,
 * trimming entries and deduplicating while preserving order.
 * @param {string | string[]} keys
 * @returns {string[]}
 */
function splitKeywords(keys) {
  if (keys == null) return [];
  const items = Array.isArray(keys) ? keys : [keys];
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (item == null) continue;
    for (const part of String(item).split(/[,，;；\n]+/)) {
      const trimmed = part.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
  }

  return result;
}

/**
 * Sanitize a string into a safe cross-platform (Windows + POSIX) filename.
 * @param {string} name
 * @param {string} [fallback='untitled']
 * @returns {string}
 */
function sanitizeFilename(name, fallback = 'untitled') {
  const safeFallback = fallback == null || String(fallback).trim() === '' ? 'untitled' : String(fallback);
  const cleaned = toText(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, 60)
    .replace(/[.\-\s]+$/g, '');

  return cleaned || safeFallback;
}

module.exports = {
  replaceMacros,
  stripCommentMacros,
  stripPluginDirectives,
  stripFrontendNoise,
  splitKeywords,
  sanitizeFilename,
};
