const test = require('node:test');
const assert = require('node:assert/strict');
const {
  replaceMacros,
  stripCommentMacros,
  stripPluginDirectives,
  stripFrontendNoise,
  splitKeywords,
  sanitizeFilename,
} = require('../skill/scripts/lib/text-clean');

test('replaceMacros replaces char/user/BOT/USER/newline/trim and preserves unknown macros', () => {
  const input = '  {{trim}}Hi {{user}} & <USER>, I am {{char}} (<BOT>).{{newline}}Keep {{custom_var}}. ';
  assert.equal(replaceMacros(input, { char: '江亦雪', user: '陈默' }), 'Hi 陈默 & 陈默, I am 江亦雪 (江亦雪).\nKeep {{custom_var}}.');
});

test('replaceMacros handles case-insensitive macros, dollar signs in values, null/empty, and missing vars', () => {
  assert.equal(replaceMacros(null, { char: 'A', user: 'B' }), '');
  assert.equal(replaceMacros(undefined), '');
  assert.equal(replaceMacros(''), '');
  assert.equal(replaceMacros('  {{CHAR}} meets <bot> and <user>{{NewLine}}{{USER}}  '), '   meets  and \n  ');
  assert.equal(replaceMacros('Hi {{char}} and {{user}}', { char: '$1$$', user: '$&' }), 'Hi $1$$ and $&');
  assert.equal(replaceMacros('  keep spaces without trim  ', { char: 'A', user: 'B' }), '  keep spaces without trim  ');
});

test('stripCommentMacros removes single-line and multi-line SillyTavern {{// ...}} comments', () => {
  assert.equal(stripCommentMacros('A{{// hidden\ncomment}}B{{// inline}}C'), 'ABC');
  assert.equal(stripCommentMacros(null), '');
  assert.equal(stripCommentMacros(''), '');
});

test('stripPluginDirectives removes catgodml/SPreset blocks and special merge tokens', () => {
  const raw = '<<<|catgodml|menu:输出:test>>>\n<|sep|><|merge|><run_tool_replacement>正文保留';
  assert.equal(stripPluginDirectives(raw).trim(), '正文保留');
  assert.equal(stripPluginDirectives('前<<<|a|b|>>>中<<<|c\nd>>>后'), '前中后');
  assert.equal(stripPluginDirectives(null), '');
  assert.equal(stripPluginDirectives(''), '');
});

test('stripFrontendNoise strips style/script/div/start/mvu-status tags while keeping prose', () => {
  const raw = '<start><style>.x{color:red}</style><div class="box">你好世界</div><mvu-status/></start>';
  assert.equal(stripFrontendNoise(raw).trim(), '你好世界');
  assert.equal(
    stripFrontendNoise('<script>alert(1)</script><span class="a">第一行</span><br/><br /><mvu-status />\n\n\n\n第二行'),
    '第一行\n\n第二行'
  );
  assert.equal(stripFrontendNoise(null), '');
  assert.equal(stripFrontendNoise(''), '');
});

test('splitKeywords splits Chinese commas, English commas, semicolons and deduplicates', () => {
  assert.deepEqual(splitKeywords(['抽签，签，木签，选择', '抽签, 签; 命运']), ['抽签', '签', '木签', '选择', '命运']);
  assert.deepEqual(splitKeywords('甲；乙\n丙, 甲，丁'), ['甲', '乙', '丙', '丁']);
  assert.deepEqual(splitKeywords(null), []);
  assert.deepEqual(splitKeywords(''), []);
  assert.deepEqual(splitKeywords([null, '', '  ,  ']), []);
});

test('sanitizeFilename removes Windows-illegal chars, trims length, and uses fallback when empty', () => {
  assert.equal(sanitizeFilename('少林/寺:伪善*佛?国<>|', 'entry'), '少林-寺-伪善-佛-国');
  assert.equal(sanitizeFilename('   ///   ', 'entry-01'), 'entry-01');
  assert.equal(sanitizeFilename(null), 'untitled');
  assert.equal(sanitizeFilename('...---...'), 'untitled');
  assert.equal(sanitizeFilename('a'.repeat(80), 'entry'), 'a'.repeat(60));
  assert.equal(sanitizeFilename('a'.repeat(59) + '/b', 'entry'), 'a'.repeat(59));
});
