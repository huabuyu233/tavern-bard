#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  brightCyan: '\x1b[96m',
  brightYellow: '\x1b[93m',
};

const GAUGE_KEY_RE =
  /(?:好感|信任|亲密|爱意|顺从|羞耻|堕落|腐化|警戒|危险|疲劳|压力|饥饿|饱食|口渴|体力|耐力|生命|血量|理智|精神|魔力|法力|能量|护盾|士气|恐惧|愤怒|黑化|进度|完成|同步|默契|热情|忠诚|专注|清醒|健康|状态值|\bhp\b|\bmp\b|\bsp\b|\bap\b|\bsan\b|sanity|stamina|health|energy|shield|affection|favor|trust|love|lust|stress|fatigue|hunger|thirst|morale|progress|loyalty|affinity|relationship|bond|(?<![a-z])(?:rate|ratio|percent|pct)(?![a-z]))/i;
const GAUGE_SUFFIX_RE = /[度率值]$/;
const NON_GAUGE_KEY_RE = /(?:温度|角度|纬度|经度|海拔|价值|市值|均值|价格|硬度|密度|长度|宽度|高度|厚度)/;

const RATIO_RE = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/;
const PERCENT_RE = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInternalKey(key) {
  return key.startsWith('$') || key.startsWith('_');
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripAnsi(str) {
  return String(str)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function sanitizeDisplayText(value, { allowNewlines = true } = {}) {
  if (value == null) return '';
  let text = stripAnsi(String(value))
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ');
  if (!allowNewlines) {
    text = text.replace(/\n+/g, ' ');
  }
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

function isZeroWidthCodePoint(cp) {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp < 0xa0) ||
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    cp === 0xfeff ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0100 && cp <= 0xe01ef)
  );
}

function isFullwidthCodePoint(cp) {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x231a ||
      cp === 0x231b ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x23e9 && cp <= 0x23ec) ||
      cp === 0x23f0 ||
      cp === 0x23f3 ||
      (cp >= 0x25fd && cp <= 0x25fe) ||
      (cp >= 0x2614 && cp <= 0x2615) ||
      (cp >= 0x2648 && cp <= 0x2653) ||
      cp === 0x267f ||
      cp === 0x2693 ||
      cp === 0x26a1 ||
      (cp >= 0x26aa && cp <= 0x26ab) ||
      (cp >= 0x26bd && cp <= 0x26be) ||
      (cp >= 0x26c4 && cp <= 0x26c5) ||
      cp === 0x26ce ||
      cp === 0x26d4 ||
      cp === 0x26ea ||
      (cp >= 0x26f2 && cp <= 0x26f3) ||
      cp === 0x26f5 ||
      cp === 0x26fa ||
      cp === 0x26fd ||
      cp === 0x2705 ||
      (cp >= 0x270a && cp <= 0x270b) ||
      cp === 0x2728 ||
      cp === 0x274c ||
      cp === 0x274e ||
      (cp >= 0x2753 && cp <= 0x2755) ||
      cp === 0x2757 ||
      (cp >= 0x2795 && cp <= 0x2797) ||
      cp === 0x27b0 ||
      cp === 0x27bf ||
      (cp >= 0x2b1b && cp <= 0x2b1c) ||
      cp === 0x2b50 ||
      cp === 0x2b55 ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3040 && cp <= 0x3247) ||
      (cp >= 0x3250 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0xa4cf) ||
      (cp >= 0xa960 && cp <= 0xa97f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x16fe0 && cp <= 0x16fe4) ||
      (cp >= 0x16ff0 && cp <= 0x16ff1) ||
      (cp >= 0x17000 && cp <= 0x187f7) ||
      (cp >= 0x18800 && cp <= 0x18cd5) ||
      (cp >= 0x18d00 && cp <= 0x18d08) ||
      (cp >= 0x1aff0 && cp <= 0x1b2fb) ||
      cp === 0x1f004 ||
      cp === 0x1f0cf ||
      cp === 0x1f18e ||
      (cp >= 0x1f191 && cp <= 0x1f19a) ||
      (cp >= 0x1f200 && cp <= 0x1f2ff) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f680 && cp <= 0x1f6ff) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x1fa00 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd))
  );
}

function charDisplayWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp === undefined || isZeroWidthCodePoint(cp)) return 0;
  return isFullwidthCodePoint(cp) ? 2 : 1;
}

/**
 * Compute terminal column width of a string, stripping ANSI escapes and counting
 * East Asian wide / fullwidth / emoji characters as width 2.
 * @param {string} str
 * @returns {number}
 */
function displayWidth(str) {
  if (str == null) return 0;
  const plain = stripAnsi(str);
  let width = 0;
  for (const ch of plain) {
    width += charDisplayWidth(ch);
  }
  return width;
}

function parseRatioString(value) {
  if (typeof value !== 'string') return null;
  const match = RATIO_RE.exec(value);
  if (!match) return null;
  const cur = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return null;
  return { cur, max, raw: value.trim() };
}

function parsePercentString(value) {
  if (typeof value !== 'string') return null;
  const match = PERCENT_RE.exec(value);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num < 0 || num > 100) return null;
  return { num, raw: value.trim() };
}

function roundDelta(num) {
  return Number(num.toFixed(4));
}

function markAddedDeep(diffs, value, prefix) {
  diffs.set(prefix, { type: 'added' });
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (isInternalKey(k)) continue;
      markAddedDeep(diffs, v, `${prefix}.${k}`);
    }
  }
}

/**
 * Compute recursive diffs between current state and previous snapshot.
 * Internal keys starting with `$` or `_` are ignored at every depth.
 * @param {object} curr
 * @param {object | null} prev
 * @returns {Map<string, { type: 'delta' | 'changed' | 'added', delta?: number, prev?: any }>}
 */
function computeDiffs(curr, prev) {
  const diffs = new Map();
  if (!isPlainObject(curr) || !isPlainObject(prev)) {
    return diffs;
  }

  function walk(currObj, prevObj, prefix) {
    for (const key of Object.keys(currObj)) {
      if (isInternalKey(key)) continue;
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const currVal = currObj[key];

      if (!Object.prototype.hasOwnProperty.call(prevObj, key)) {
        markAddedDeep(diffs, currVal, fullPath);
        continue;
      }

      const prevVal = prevObj[key];

      if (isPlainObject(currVal) && isPlainObject(prevVal)) {
        walk(currVal, prevVal, fullPath);
        continue;
      }

      if (typeof currVal === 'number' && typeof prevVal === 'number' && Number.isFinite(currVal) && Number.isFinite(prevVal)) {
        const delta = roundDelta(currVal - prevVal);
        if (delta !== 0) {
          diffs.set(fullPath, { type: 'delta', delta, prev: prevVal });
        }
        continue;
      }

      const currRatio = parseRatioString(currVal);
      const prevRatio = parseRatioString(prevVal);
      if (currRatio && prevRatio && currRatio.max === prevRatio.max) {
        const delta = roundDelta(currRatio.cur - prevRatio.cur);
        if (delta !== 0) {
          diffs.set(fullPath, { type: 'delta', delta, prev: prevVal });
        }
        continue;
      }

      if (Array.isArray(currVal) && Array.isArray(prevVal)) {
        if (JSON.stringify(currVal) !== JSON.stringify(prevVal)) {
          diffs.set(fullPath, { type: 'changed', prev: prevVal });
        }
        continue;
      }

      if (currVal !== prevVal) {
        diffs.set(fullPath, { type: 'changed', prev: prevVal });
      }
    }
  }

  walk(curr, prev, '');
  return diffs;
}

/**
 * Safely read and parse a JSON object file, returning `lastValid` on read errors,
 * empty content, truncated/corrupt mid-write JSON, or non-object JSON literals.
 * @param {string} filePath
 * @param {any} [lastValid=null]
 * @returns {any}
 */
function safeReadJson(filePath, lastValid = null) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return lastValid;
  }

  const trimmed = stripBom(raw).trim();
  if (!trimmed) return lastValid;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) return lastValid;
    return parsed;
  } catch {
    return lastValid;
  }
}

function visibleEntries(obj) {
  if (!isPlainObject(obj)) return [];
  return Object.entries(obj).filter(([key]) => !isInternalKey(key));
}

function isStatusDetailPair(obj) {
  const entries = visibleEntries(obj);
  if (entries.length === 0 || entries.length > 2) return null;

  const map = new Map(entries);
  let status;
  let detail;
  if (map.has('状态') && entries.every(([k]) => k === '状态' || k === '详情')) {
    status = map.get('状态');
    detail = map.get('详情');
  } else {
    const lower = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
    if (
      lower.has('status') &&
      lower.has('detail') &&
      entries.every(([k]) => k.toLowerCase() === 'status' || k.toLowerCase() === 'detail')
    ) {
      status = lower.get('status');
      detail = lower.get('detail');
    } else {
      return null;
    }
  }

  return isScalar(status) && (detail === undefined || isScalar(detail)) ? { status, detail } : null;
}

function isGaugeField(key, value) {
  if (parseRatioString(value)) return true;
  if (parsePercentString(value)) return true;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) {
    if (NON_GAUGE_KEY_RE.test(key)) return false;
    return GAUGE_KEY_RE.test(key) || GAUGE_SUFFIX_RE.test(key);
  }
  return false;
}

function getProgressInfo(key, value) {
  const ratio = parseRatioString(value);
  if (ratio) {
    return {
      pct: Math.max(0, Math.min(1, ratio.cur / ratio.max)),
      label: ratio.raw,
    };
  }
  const pct = parsePercentString(value);
  if (pct) {
    return {
      pct: Math.max(0, Math.min(1, pct.num / 100)),
      label: pct.raw,
    };
  }
  if (isGaugeField(key, value)) {
    return {
      pct: Math.max(0, Math.min(1, value / 100)),
      label: String(value),
    };
  }
  return null;
}

function splitBreakableUnits(text) {
  const cleanText = sanitizeDisplayText(text, { allowNewlines: true });
  const units = [];
  let i = 0;
  while (i < cleanText.length) {
    const code = cleanText.codePointAt(i);
    const ch = String.fromCodePoint(code);
    if (ch === '\n') {
      units.push({ type: 'nl', text: '\n' });
      i += ch.length;
    } else if (ch === ' ') {
      let j = i + ch.length;
      while (j < cleanText.length && cleanText[j] === ' ') j += 1;
      units.push({ type: 'ws', text: cleanText.slice(i, j) });
      i = j;
    } else if (code >= 0x21 && code <= 0x7e) {
      let j = i + ch.length;
      while (j < cleanText.length) {
        const nextCode = cleanText.codePointAt(j);
        if (nextCode < 0x21 || nextCode > 0x7e) break;
        j += 1;
      }
      units.push({ type: 'word', text: cleanText.slice(i, j) });
      i = j;
    } else {
      units.push({ type: 'char', text: ch });
      i += ch.length;
    }
  }
  return units;
}

function pushSeg(line, text, style) {
  if (!text) return;
  const last = line[line.length - 1];
  if (last && last.style === style) {
    last.text += text;
  } else {
    line.push({ text, style });
  }
}

/**
 * Wrap styled segments to `maxWidth` columns without splitting atomic tokens
 * unless an individual token exceeds the line budget.
 * @param {Array<{ text: string, style?: string, atomic?: boolean }>} segments
 * @param {number} maxWidth
 * @param {number} [continuationIndent=2]
 * @returns {Array<Array<{ text: string, style?: string }>>}
 */
function wrapSegments(segments, maxWidth, continuationIndent = 2) {
  const safeIndent = Math.max(0, Math.min(continuationIndent, Math.max(0, maxWidth - 8)));
  const indentText = ' '.repeat(safeIndent);
  const lines = [];
  let current = [];
  let currentWidth = 0;

  const startContinuationLine = () => {
    lines.push(current);
    current = safeIndent > 0 ? [{ text: indentText, style: null }] : [];
    currentWidth = safeIndent;
  };

  const appendCharByChar = (text, style) => {
    for (const ch of text) {
      const w = charDisplayWidth(ch);
      if (currentWidth > safeIndent && currentWidth + w > maxWidth) {
        startContinuationLine();
      }
      if (currentWidth === 0 && current.length === 0 && currentWidth + w > maxWidth) {
        // Extremely narrow width guard: emit single wide char anyway to prevent infinite loop
        pushSeg(current, ch, style);
        currentWidth += w;
        continue;
      }
      pushSeg(current, ch, style);
      currentWidth += w;
    }
  };

  for (const seg of segments) {
    if (!seg || !seg.text) continue;
    const style = seg.style || null;

    if (seg.atomic) {
      const segWidth = displayWidth(seg.text);
      if (currentWidth + segWidth <= maxWidth) {
        pushSeg(current, seg.text, style);
        currentWidth += segWidth;
      } else if (safeIndent + segWidth <= maxWidth) {
        if (current.length > 0 && !(lines.length === 0 && currentWidth === 0)) {
          startContinuationLine();
        }
        pushSeg(current, seg.text, style);
        currentWidth += segWidth;
      } else {
        appendCharByChar(seg.text, style);
      }
      continue;
    }

    const units = splitBreakableUnits(seg.text);
    for (const unit of units) {
      if (unit.type === 'nl') {
        startContinuationLine();
        continue;
      }

      const unitWidth = displayWidth(unit.text);
      if (unit.type === 'ws') {
        if (currentWidth === 0 || (lines.length > 0 && currentWidth === safeIndent)) {
          continue;
        }
        if (currentWidth + unitWidth <= maxWidth) {
          pushSeg(current, unit.text, style);
          currentWidth += unitWidth;
        } else {
          startContinuationLine();
        }
        continue;
      }

      if (currentWidth + unitWidth <= maxWidth) {
        pushSeg(current, unit.text, style);
        currentWidth += unitWidth;
      } else if (safeIndent + unitWidth <= maxWidth) {
        if (currentWidth > (lines.length > 0 ? safeIndent : 0)) {
          startContinuationLine();
        }
        pushSeg(current, unit.text, style);
        currentWidth += unitWidth;
      } else {
        appendCharByChar(unit.text, style);
      }
    }
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}

const STYLE_CODES = {
  border: ANSI.gray,
  title: `${ANSI.bold}${ANSI.brightCyan}`,
  section: `${ANSI.bold}${ANSI.cyan}`,
  subSection: `${ANSI.bold}${ANSI.blue}`,
  label: ANSI.cyan,
  value: '',
  number: ANSI.brightYellow,
  boolTrue: ANSI.green,
  boolFalse: ANSI.red,
  muted: ANSI.dim,
  detail: ANSI.gray,
  chip: `${ANSI.bold}${ANSI.magenta}`,
  barOk: ANSI.green,
  barMid: ANSI.yellow,
  barLow: ANSI.red,
  barEmpty: ANSI.gray,
  diffUp: `${ANSI.bold}${ANSI.green}`,
  diffDown: `${ANSI.bold}${ANSI.red}`,
  diffChanged: `${ANSI.bold}${ANSI.yellow}`,
  diffAdded: `${ANSI.bold}${ANSI.cyan}`,
};

function styleText(text, style, useColor) {
  if (!text) return '';
  if (!useColor || !style || !STYLE_CODES[style]) return text;
  return `${STYLE_CODES[style]}${text}${ANSI.reset}`;
}

function renderDiffSegments(diff) {
  if (!diff) return [];
  if (diff.type === 'delta') {
    const sign = diff.delta > 0 ? '+' : '';
    const style = diff.delta > 0 ? 'diffUp' : 'diffDown';
    return [
      { text: ' ' },
      { text: `(${sign}${diff.delta})`, style, atomic: true },
    ];
  }
  if (diff.type === 'changed') {
    return [
      { text: ' ' },
      { text: '↑', style: 'diffChanged', atomic: true },
    ];
  }
  if (diff.type === 'added') {
    return [
      { text: ' ' },
      { text: '+NEW', style: 'diffAdded', atomic: true },
    ];
  }
  return [];
}

function buildProgressSegments(progress, barWidth) {
  const filled = Math.round(progress.pct * barWidth);
  const empty = Math.max(0, barWidth - filled);
  const fillStyle = progress.pct >= 0.7 ? 'barOk' : progress.pct >= 0.35 ? 'barMid' : 'barLow';
  const label = sanitizeDisplayText(progress.label, { allowNewlines: false });

  return [
    { text: '[', style: 'muted', atomic: true },
    { text: '█'.repeat(filled), style: fillStyle, atomic: true },
    { text: '░'.repeat(empty), style: 'barEmpty', atomic: true },
    { text: '] ', style: 'muted', atomic: true },
    { text: label, style: 'number', atomic: true },
  ];
}

function isScalar(value) {
  return value === null || value === undefined || typeof value !== 'object';
}

function formatScalarSegments(value) {
  if (value === null || value === undefined) {
    return [{ text: '—', style: 'muted' }];
  }
  if (typeof value === 'boolean') {
    return [{ text: value ? '是' : '否', style: value ? 'boolTrue' : 'boolFalse' }];
  }
  if (typeof value === 'number') {
    return [{ text: Number.isFinite(value) ? String(value) : '—', style: 'number' }];
  }
  const str = sanitizeDisplayText(value, { allowNewlines: true });
  return [{ text: str || '—', style: str ? 'value' : 'muted' }];
}

function resolveStatusDiff(diffs, fieldPath) {
  const direct = diffs.get(fieldPath);
  if (direct) return direct;
  const statusDiff = diffs.get(`${fieldPath}.状态`) || diffs.get(`${fieldPath}.status`);
  const detailDiff = diffs.get(`${fieldPath}.详情`) || diffs.get(`${fieldPath}.detail`);
  if (statusDiff) return statusDiff;
  if (detailDiff) return { type: 'changed', prev: detailDiff.prev };
  return null;
}

function emitWrappedRows(rows, segments, innerWidth, indent = 2) {
  for (const line of wrapSegments(segments, innerWidth, indent)) {
    rows.push({ kind: 'line', segments: line });
  }
}

function renderArrayField(ctx, key, value, indentStr, continuationIndent, diff) {
  const { rows, innerWidth, indentCols } = ctx;
  const safeKey = sanitizeDisplayText(key, { allowNewlines: false });
  const indentSeg = indentStr ? [{ text: indentStr, atomic: true }] : [];
  if (value.length === 0) {
    emitWrappedRows(
      rows,
      [
        ...indentSeg,
        { text: `${safeKey}: `, style: 'label', atomic: true },
        { text: '(无)', style: 'muted' },
        ...renderDiffSegments(diff),
      ],
      innerWidth,
      continuationIndent
    );
    return;
  }

  const allScalars = value.every(isScalar);
  const sanitizedScalars = allScalars
    ? value.map((item) => sanitizeDisplayText(item ?? '', { allowNewlines: false }))
    : null;
  const shortChips =
    allScalars && value.length <= 10 && sanitizedScalars.every((text) => displayWidth(text) <= 20);
  if (shortChips) {
    const segs = [
      ...indentSeg,
      { text: `${safeKey}: `, style: 'label', atomic: true },
    ];
    sanitizedScalars.forEach((chipText, idx) => {
      if (idx > 0) segs.push({ text: ' ' });
      segs.push({ text: `[${chipText}]`, style: 'chip', atomic: true });
    });
    segs.push(...renderDiffSegments(diff));
    emitWrappedRows(rows, segs, innerWidth, continuationIndent);
    return;
  }

  emitWrappedRows(
    rows,
    [...indentSeg, { text: `${safeKey}:`, style: 'label' }, ...renderDiffSegments(diff)],
    innerWidth,
    continuationIndent
  );
  const bulletIndent = Math.min(indentCols + 4, Math.max(0, innerWidth - 8));
  value.forEach((item, idx) => {
    const text = isPlainObject(item)
      ? visibleEntries(item)
          .map(([k, v]) => {
            const itemKey = sanitizeDisplayText(k, { allowNewlines: false });
            const itemVal = isScalar(v)
              ? sanitizeDisplayText(v, { allowNewlines: true })
              : sanitizeDisplayText(JSON.stringify(v), { allowNewlines: false });
            return `${itemKey}: ${itemVal}`;
          })
          .join(' | ') || '(空)'
      : item == null
        ? `#${idx + 1}`
        : sanitizeDisplayText(item, { allowNewlines: true });
    emitWrappedRows(
      rows,
      [
        { text: `${indentStr}  • `, style: 'muted', atomic: true },
        { text, style: 'value' },
      ],
      innerWidth,
      bulletIndent
    );
  });
}

function renderFieldRows(ctx, key, value, fieldPath, depth) {
  const { rows, diffs, innerWidth, barWidth } = ctx;
  const safeKey = sanitizeDisplayText(key, { allowNewlines: false });
  const indentCols = Math.min(Math.max(0, depth - 1) * 2, Math.max(0, innerWidth - 12));
  const indentStr = ' '.repeat(indentCols);
  const indentSeg = indentStr ? [{ text: indentStr, atomic: true }] : [];
  const continuationIndent = Math.min(indentCols + 2, Math.max(0, innerWidth - 8));
  const diff = diffs.get(fieldPath);

  const statusCard = isPlainObject(value) ? isStatusDetailPair(value) : null;
  if (statusCard) {
    const cardDiff = resolveStatusDiff(diffs, fieldPath);
    const cleanStatus = statusCard.status == null ? '' : sanitizeDisplayText(statusCard.status, { allowNewlines: true });
    const statusText = cleanStatus || '—';
    emitWrappedRows(
      rows,
      [
        ...indentSeg,
        { text: `${safeKey}: `, style: 'label', atomic: true },
        { text: statusText, style: 'value' },
        ...renderDiffSegments(cardDiff),
      ],
      innerWidth,
      continuationIndent
    );
    const detailText = statusCard.detail == null ? '' : sanitizeDisplayText(statusCard.detail, { allowNewlines: true });
    if (detailText.trim() !== '') {
      emitWrappedRows(
        rows,
        [
          { text: `${indentStr}  ↳ `, style: 'muted', atomic: true },
          { text: detailText, style: 'detail' },
        ],
        innerWidth,
        Math.min(indentCols + 4, Math.max(0, innerWidth - 8))
      );
    }
    return;
  }

  if (isPlainObject(value)) {
    const childEntries = visibleEntries(value);
    if (childEntries.length === 0) {
      if (Object.keys(value).length === 0) {
        emitWrappedRows(
          rows,
          [
            ...indentSeg,
            { text: `${safeKey}: `, style: 'label', atomic: true },
            { text: '(空)', style: 'muted' },
            ...renderDiffSegments(diff),
          ],
          innerWidth,
          continuationIndent
        );
      }
      return;
    }

    if (depth === 0) {
      rows.push({ kind: 'divider', label: safeKey, diff });
      for (const [childKey, childVal] of childEntries) {
        renderFieldRows(ctx, childKey, childVal, `${fieldPath}.${childKey}`, 1);
      }
    } else {
      emitWrappedRows(
        rows,
        [...indentSeg, { text: `▸ ${safeKey}`, style: 'subSection' }, ...renderDiffSegments(diff)],
        innerWidth,
        continuationIndent
      );
      for (const [childKey, childVal] of childEntries) {
        renderFieldRows(ctx, childKey, childVal, `${fieldPath}.${childKey}`, depth + 1);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    renderArrayField({ rows, innerWidth, indentCols }, safeKey, value, indentStr, continuationIndent, diff);
    return;
  }

  const progress = getProgressInfo(key, value);
  if (progress) {
    emitWrappedRows(
      rows,
      [
        ...indentSeg,
        { text: `${safeKey}: `, style: 'label', atomic: true },
        ...buildProgressSegments(progress, barWidth),
        ...renderDiffSegments(diff),
      ],
      innerWidth,
      continuationIndent
    );
    return;
  }

  emitWrappedRows(
    rows,
    [
      ...indentSeg,
      { text: `${safeKey}: `, style: 'label', atomic: true },
      ...formatScalarSegments(value),
      ...renderDiffSegments(diff),
    ],
    innerWidth,
    continuationIndent
  );
}

function formatDividerLine(label, diff, width, useColor) {
  const safeLabel = sanitizeDisplayText(label, { allowNewlines: false });
  const badgeText = diff && diff.type === 'added' ? ' +NEW' : '';
  const rawLabel = ` ${safeLabel}${badgeText} `;
  const maxLabelBudget = Math.max(4, width - 5);
  let clippedLabel = safeLabel;

  if (displayWidth(rawLabel) > maxLabelBudget) {
    clippedLabel = '';
    let acc = 0;
    const limit = Math.max(2, maxLabelBudget - displayWidth(badgeText) - 3);
    for (const ch of safeLabel) {
      const w = charDisplayWidth(ch);
      if (acc + w > limit) break;
      clippedLabel += ch;
      acc += w;
    }
    clippedLabel += '…';
  }

  const labelStyled =
    styleText(` ${clippedLabel}`, 'section', useColor) +
    (badgeText ? styleText(badgeText, 'diffAdded', useColor) : '') +
    ' ';
  const usedWidth = displayWidth(` ${clippedLabel}${badgeText} `);
  const dashCount = Math.max(1, width - 3 - usedWidth);
  return `${styleText('├─', 'border', useColor)}${labelStyled}${styleText(`${'─'.repeat(dashCount)}┤`, 'border', useColor)}`;
}

/**
 * Render an MVU state object into a framed, ANSI-styled, CJK-width-safe terminal dashboard.
 * @param {object} state
 * @param {object | null} [prevState=null]
 * @param {{ width?: number, color?: boolean, title?: string }} [options]
 * @returns {string}
 */
function renderState(state, prevState = null, options = {}) {
  const width = Math.max(24, Number.isFinite(options.width) ? Math.floor(options.width) : 64);
  const innerWidth = width - 4;
  const useColor = options.color !== false;
  const cleanTitle = options.title == null ? '' : sanitizeDisplayText(options.title, { allowNewlines: false }).trim();
  const title = cleanTitle || '🎭 MVU 状态面板';
  const barWidth = innerWidth < 34 ? 6 : innerWidth < 50 ? 8 : 12;

  const diffs = computeDiffs(state, prevState);
  const rows = [];
  const ctx = { rows, diffs, innerWidth, barWidth };

  emitWrappedRows(rows, [{ text: title, style: 'title' }], innerWidth, 2);
  const headerRowsCount = rows.length;

  const entries = visibleEntries(state);
  const topScalars = [];
  const topSections = [];
  for (const [k, v] of entries) {
    if (isPlainObject(v) && !isStatusDetailPair(v)) {
      topSections.push([k, v]);
    } else {
      topScalars.push([k, v]);
    }
  }

  if (topScalars.length > 0) {
    rows.push({ kind: 'headerRule' });
    for (const [k, v] of topScalars) {
      renderFieldRows(ctx, k, v, k, 0);
    }
  }
  for (const [k, v] of topSections) {
    renderFieldRows(ctx, k, v, k, 0);
  }
  if (rows.length === headerRowsCount) {
    rows.push({ kind: 'headerRule' });
    emitWrappedRows(rows, [{ text: '(暂无可显示的状态字段)', style: 'muted' }], innerWidth, 2);
  }

  const outputLines = [styleText(`╭${'─'.repeat(width - 2)}╮`, 'border', useColor)];
  for (const row of rows) {
    if (row.kind === 'headerRule') {
      outputLines.push(styleText(`├${'─'.repeat(width - 2)}┤`, 'border', useColor));
    } else if (row.kind === 'divider') {
      outputLines.push(formatDividerLine(row.label, row.diff, width, useColor));
    } else {
      const contentPlainWidth = row.segments.reduce((sum, s) => sum + displayWidth(s.text), 0);
      const padWidth = Math.max(0, innerWidth - contentPlainWidth);
      const renderedContent = row.segments.map((s) => styleText(s.text, s.style, useColor)).join('');
      outputLines.push(
        `${styleText('│ ', 'border', useColor)}${renderedContent}${' '.repeat(padWidth)}${styleText(' │', 'border', useColor)}`
      );
    }
  }
  outputLines.push(styleText(`╰${'─'.repeat(width - 2)}╯`, 'border', useColor));
  return `${outputLines.join('\n')}\n`;
}

function resolveCampaignTitle(statePath) {
  const campaignPath = path.join(path.dirname(statePath), 'campaign.json');
  const campaign = safeReadJson(campaignPath, null);
  if (!campaign) return undefined;

  const charName = typeof campaign.char === 'string' ? campaign.char.trim() : '';
  const userName = typeof campaign.user === 'string' ? campaign.user.trim() : '';
  if (charName && userName) return `🎭 ${charName} × ${userName}`;
  if (charName) return `🎭 ${charName}`;
  if (userName) return `🎭 ${userName}`;
  return undefined;
}

function getHelpText() {
  return `Usage:
  node hud.js [path/to/state.json] [--once] [--no-color] [--width <n>] [--title <text>]

Options:
  [path/to/state.json]  Path to state.json (default: ./state.json)
  --once                Render a single frame and exit (exits non-zero if missing/invalid)
  --no-color            Disable ANSI color escape sequences
  --width <n>           Override HUD frame width (minimum 24)
  --title <text>        Override header title (default: read campaign.json or MVU 状态面板)
  --help, -h            Show this help message
`;
}

function takeFlagValue(argv, index, inlineVal, flagName) {
  if (inlineVal !== undefined) return { value: inlineVal, nextIndex: index };
  const next = argv[index + 1];
  if (next === undefined || next === '-h' || next.startsWith('--')) {
    throw new Error(`Option ${flagName} requires a value`);
  }
  return { value: next, nextIndex: index + 1 };
}

function parseHudArgs(argv) {
  const opts = {
    stateArg: null,
    once: false,
    noColor: false,
    width: undefined,
    title: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--once') {
      opts.once = true;
      continue;
    }
    if (arg === '--no-color') {
      opts.noColor = true;
      continue;
    }

    if (!arg.startsWith('-')) {
      if (opts.stateArg !== null) {
        throw new Error(`Unexpected positional argument: ${arg}`);
      }
      opts.stateArg = arg;
      continue;
    }

    const eqIdx = arg.indexOf('=');
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;

    if (flag === '--width') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      const parsedWidth = Number(taken.value);
      if (!Number.isFinite(parsedWidth) || parsedWidth < 1) {
        throw new Error(`Invalid --width value: ${taken.value}`);
      }
      opts.width = Math.floor(parsedWidth);
      i = taken.nextIndex;
    } else if (flag === '--title') {
      const taken = takeFlagValue(argv, i, inlineVal, flag);
      opts.title = taken.value;
      i = taken.nextIndex;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function resolveStateFilePath(stateArg) {
  const candidate = path.resolve(stateArg || path.join(process.cwd(), 'state.json'));
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.join(candidate, 'state.json');
    }
  } catch {
    // ignore stat errors
  }
  return candidate;
}

function resolveFrameWidth(explicitWidth) {
  if (Number.isFinite(explicitWidth)) return explicitWidth;
  if (process.stdout.isTTY && Number.isFinite(process.stdout.columns)) {
    return Math.min(96, Math.max(36, process.stdout.columns - 2));
  }
  return 64;
}

function runOnce(statePath, renderOpts) {
  if (!fs.existsSync(statePath)) {
    process.stderr.write(`Error: state.json not found at "${statePath}".\n`);
    process.exitCode = 1;
    return;
  }

  const state = safeReadJson(statePath, null);
  if (!state) {
    process.stderr.write(`Error: failed to parse valid JSON object from "${statePath}".\n`);
    process.exitCode = 1;
    return;
  }

  const title = renderOpts.title || resolveCampaignTitle(statePath);
  const frame = renderState(state, null, {
    width: resolveFrameWidth(renderOpts.width),
    color: renderOpts.color,
    title,
  });
  process.stdout.write(frame);
}

function runWatch(statePath, renderOpts) {
  const stateDir = path.dirname(statePath);
  const stateBase = path.basename(statePath);
  const isTTY = Boolean(process.stdout.isTTY);

  let lastValid = null;
  let lastSerialized = null;
  let hasDrawnFrame = false;
  let watcher = null;

  const drawFrame = (curr, prev) => {
    const title = renderOpts.title || resolveCampaignTitle(statePath);
    const frame = renderState(curr, prev, {
      width: resolveFrameWidth(renderOpts.width),
      color: renderOpts.color,
      title,
    });
    const footer = renderOpts.color
      ? `${ANSI.gray}Watching ${statePath} (Ctrl+C to exit)${ANSI.reset}\n`
      : `Watching ${statePath} (Ctrl+C to exit)\n`;

    if (isTTY) {
      process.stdout.write(`\x1b[H\x1b[J${frame}${footer}`);
    } else {
      const prefix = hasDrawnFrame ? '\n' : '';
      process.stdout.write(`${prefix}${frame}${footer}`);
    }
    hasDrawnFrame = true;
  };

  const checkUpdate = () => {
    const next = safeReadJson(statePath, lastValid);
    if (!next) return;
    const serialized = JSON.stringify(next);
    if (serialized === lastSerialized) return;

    const prevSnapshot = lastValid;
    lastValid = next;
    lastSerialized = serialized;
    drawFrame(next, prevSnapshot);
  };

  // Initial draw or waiting prompt
  const initial = safeReadJson(statePath, null);
  if (initial) {
    lastValid = initial;
    lastSerialized = JSON.stringify(initial);
    drawFrame(initial, null);
  } else {
    const waitingMsg = `Waiting for ${stateBase} at: ${statePath}\n(Start or continue a status-enabled campaign; press Ctrl+C to exit.)\n`;
    process.stdout.write(isTTY ? `\x1b[H\x1b[J${waitingMsg}` : waitingMsg);
  }

  try {
    if (fs.existsSync(stateDir)) {
      watcher = fs.watch(stateDir, { persistent: true }, (_eventType, filename) => {
        if (!filename || filename === stateBase || filename === 'campaign.json') {
          checkUpdate();
        }
      });
      watcher.on('error', () => {
        // Ignore transient watch errors; 500ms polling fallback remains active
      });
    }
  } catch {
    // 500ms polling fallback remains active even if directory cannot be watched yet
  }

  const pollTimer = setInterval(checkUpdate, 500);

  const shutdown = () => {
    clearInterval(pollTimer);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function main() {
  let opts;
  try {
    opts = parseHudArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n${getHelpText()}`);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    process.stdout.write(getHelpText());
    return;
  }

  const statePath = resolveStateFilePath(opts.stateArg);
  const useColor = !opts.noColor && !process.env.NO_COLOR;
  const renderOpts = {
    width: opts.width,
    color: useColor,
    title: opts.title,
  };

  if (opts.once) {
    runOnce(statePath, renderOpts);
    return;
  }

  runWatch(statePath, renderOpts);
}

if (require.main === module) {
  main();
}

module.exports = {
  computeDiffs,
  renderState,
  safeReadJson,
  displayWidth,
};
