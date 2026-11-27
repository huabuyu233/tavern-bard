const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  loadCard,
  loadWorldbook,
  extractCardBundle,
} = require('../skill/scripts/lib/card-loader');

const FIXTURE_PNG = path.resolve(
  __dirname,
  '..',
  '示例资源',
  '角色卡',
  'user可以为所欲为，char无条件包容user一切言行，并视为理所当然的平然世界.png'
);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); // parser skips CRC; zeroed placeholder is fine for synthetic tests
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makeTextChunk(keyword, text) {
  return makePngChunk(
    'tEXt',
    Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')])
  );
}

function makeITXtChunk(keyword, text, compressed = false, lang = 'zh-CN', translated = '角色卡') {
  const raw = Buffer.from(text, 'utf8');
  const payload = compressed ? zlib.deflateSync(raw) : raw;
  return makePngChunk(
    'iTXt',
    Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0]),
      Buffer.from([compressed ? 1 : 0, 0]),
      Buffer.from(lang, 'ascii'),
      Buffer.from([0]),
      Buffer.from(translated, 'utf8'),
      Buffer.from([0]),
      payload,
    ])
  );
}

function buildSyntheticPng(chunks) {
  const ihdr = makePngChunk('IHDR', Buffer.alloc(13));
  const iend = makePngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([PNG_SIG, ihdr, ...chunks, iend]);
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-bard-card-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('loadCard unwraps V1 flat JSON, V2 { data }, and DSH { raw: { data } }', () => {
  withTempDir((dir) => {
    const v1Path = path.join(dir, 'v1.json');
    fs.writeFileSync(
      v1Path,
      JSON.stringify({
        name: '林秋白',
        description: 'V1描述',
        personality: '冷静',
        scenario: '雪夜客栈',
        first_mes: '你好，{{user}}。',
        mes_example: '',
        creatorcomment: '旧版备注',
      })
    );
    const v1 = loadCard(v1Path);
    assert.equal(v1.name, '林秋白');
    assert.equal(v1.description, 'V1描述');
    assert.equal(v1.creator_notes, '旧版备注');
    assert.deepEqual(v1.alternate_greetings, []);

    const v2Path = path.join(dir, 'v2.json');
    fs.writeFileSync(
      v2Path,
      JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: '江亦雪',
          description: 'V2描述',
          personality: '清冷',
          scenario: '宗门禁地',
          first_mes: '请止步。',
          alternate_greetings: ['备用开场'],
          mes_example: '<START>\n{{char}}: ...',
          system_prompt: '保持人设',
          post_history_instructions: '勿出戏',
          creator_notes: '作者注',
          extensions: { variables: { 好感度: 50 } },
        },
      })
    );
    const v2 = loadCard(v2Path);
    assert.equal(v2.name, '江亦雪');
    assert.equal(v2.system_prompt, '保持人设');
    assert.deepEqual(v2.alternate_greetings, ['备用开场']);
    assert.deepEqual(v2.extensions.variables, { 好感度: 50 });

    const dshPath = path.join(dir, 'dsh.json');
    fs.writeFileSync(
      dshPath,
      JSON.stringify({
        id: 'dsh-123',
        raw: {
          spec: 'chara_card_v3',
          spec_version: '3.0',
          data: {
            name: '苏晚晴',
            description: 'DSH描述',
            first_mes: '久违了。',
          },
        },
      })
    );
    const dsh = loadCard(dshPath);
    assert.equal(dsh.name, '苏晚晴');
    assert.equal(dsh.description, 'DSH描述');
    assert.equal(dsh.first_mes, '久违了。');
  });
});

test('loadCard parses PNG tEXt (ccv3 wins over chara), compressed/raw iTXt, and rejects corrupt files', () => {
  withTempDir((dir) => {
    const charaB64 = Buffer.from(JSON.stringify({ name: '旧Chara卡', description: 'old' }), 'utf8').toString('base64');
    const ccv3B64 = Buffer.from(
      JSON.stringify({ spec: 'chara_card_v3', data: { name: '新CCV3卡', description: 'new' } }),
      'utf8'
    ).toString('base64');

    const bothPngPath = path.join(dir, 'both.png');
    fs.writeFileSync(bothPngPath, buildSyntheticPng([makeTextChunk('chara', charaB64), makeTextChunk('ccv3', ccv3B64)]));
    const loadedBoth = loadCard(bothPngPath);
    assert.equal(loadedBoth.name, '新CCV3卡');
    assert.equal(loadedBoth.description, 'new');

    const itxtZipPath = path.join(dir, 'itxt-zip.png');
    const itxtPayload = Buffer.from(
      JSON.stringify({ spec: 'chara_card_v3', data: { name: '压缩卡片', first_mes: '压缩问候' } }),
      'utf8'
    ).toString('base64');
    fs.writeFileSync(itxtZipPath, buildSyntheticPng([makeITXtChunk('ccv3', itxtPayload, true)]));
    const loadedZip = loadCard(itxtZipPath);
    assert.equal(loadedZip.name, '压缩卡片');
    assert.equal(loadedZip.first_mes, '压缩问候');

    const itxtRawPath = path.join(dir, 'itxt-raw.png');
    fs.writeFileSync(itxtRawPath, buildSyntheticPng([makeITXtChunk('ccv3', itxtPayload, false)]));
    assert.equal(loadCard(itxtRawPath).name, '压缩卡片');

    const corruptPngPath = path.join(dir, 'corrupt.png');
    fs.writeFileSync(corruptPngPath, 'not a png file at all');
    assert.throws(() => loadCard(corruptPngPath), /PNG|signature/i);

    const noMetaPngPath = path.join(dir, 'empty.png');
    fs.writeFileSync(noMetaPngPath, buildSyntheticPng([]));
    assert.throws(() => loadCard(noMetaPngPath), /ccv3|chara/i);
  });
});

test('loadCard and extractCardBundle parse real fixture PNG and detect user状态栏 in statusCandidates', () => {
  const card = loadCard(FIXTURE_PNG);
  assert.equal(card.name, '角煮风格平然色情-1115');
  assert.ok(card.first_mes.includes('{{user}}'));
  assert.ok(card.character_book && card.character_book.entries);

  const bundle = extractCardBundle(card, [], { user: '林渊' });
  assert.equal(bundle.meta.char, '角煮风格平然色情-1115');
  assert.equal(bundle.meta.user, '林渊');
  assert.equal(bundle.greetings.length, 1);
  assert.ok(bundle.greetings[0].includes('林渊'));
  assert.ok(!bundle.greetings[0].includes('{{user}}'));
  assert.ok(!bundle.characterMd.includes('eyJjaXBoZXJ0ZXh0'));

  // Constant entries sorted by insertion_order (-2 平然色情 before 99999 指导), excluding user状态栏
  assert.ok(bundle.worldbook.always.includes('### 平然色情'));
  assert.ok(bundle.worldbook.always.includes('### 指导'));
  assert.ok(bundle.worldbook.always.indexOf('### 平然色情') < bundle.worldbook.always.indexOf('### 指导'));
  assert.ok(bundle.worldbook.always.includes('视林渊为普通人'));
  assert.ok(!bundle.worldbook.always.includes('<StatusBlock_format>'));
  assert.ok(!bundle.worldbook.always.includes('### user状态栏'));

  // Status candidates contain user状态栏 prompt AND active regex scripts (skipping disabled ones)
  const promptStatus = bundle.statusCandidates.find((s) => s.kind === 'frontend-prompt' && s.title.includes('user状态栏'));
  assert.ok(promptStatus, 'expected frontend-prompt candidate for user状态栏');
  assert.ok(promptStatus.content.includes('<StatusBlock_format>'));

  const regexCandidates = bundle.statusCandidates.filter((s) => s.kind === 'frontend-regex');
  assert.ok(regexCandidates.length >= 1, 'expected enabled frontend-regex status candidates');
  assert.ok(!regexCandidates.some((s) => s.title.includes('旧')), 'disabled old regex script should be ignored');
});

test('loadWorldbook and extractCardBundle classify [initvar], disabled, constant, keys, and colliding filenames', () => {
  withTempDir((dir) => {
    const wbObjectPath = path.join(dir, 'wb-obj.json');
    fs.writeFileSync(
      wbObjectPath,
      JSON.stringify({
        entries: {
          '0': {
            uid: 0,
            comment: '[initvar] 初始化变量',
            disable: true,
            constant: false,
            key: ['init'],
            content: '<initvar>\n{"世界":{"天气":"晴"}}\n</initvar>',
            order: 1,
          },
          '1': {
            uid: 1,
            comment: '废弃旧设定',
            disable: true,
            key: ['旧'],
            content: '不要使用这条状态栏说明',
            order: 2,
          },
          '2': {
            uid: 2,
            comment: 'foo',
            disable: false,
            constant: false,
            key: ['抽签，签，木签', '抽签, 命运'],
            content: '第一条{{char}}与{{user}}的词条<mvu-status/>',
            order: 5,
          },
          '3': {
            uid: 3,
            comment: 'foo',
            disable: false,
            constant: false,
            key: ['玄学；占卜'],
            content: '第二条同名{{// 隐藏注释}}词条',
            order: 6,
          },
        },
      })
    );

    const wbEntries = loadWorldbook(wbObjectPath);
    assert.equal(wbEntries.length, 4);
    assert.equal(wbEntries[0].enabled, false);
    assert.deepEqual(wbEntries[2].keys, ['抽签', '签', '木签', '命运']);

    const wbArrayPath = path.join(dir, 'wb-arr.json');
    fs.writeFileSync(
      wbArrayPath,
      JSON.stringify([
        {
          comment: '后置常驻',
          enabled: true,
          constant: true,
          insertion_order: 20,
          content: '常驻内容B',
        },
        {
          comment: '前置常驻',
          enabled: true,
          constant: true,
          insertion_order: 5,
          content: '常驻内容A',
        },
      ])
    );
    const extraArray = loadWorldbook(wbArrayPath);
    assert.equal(extraArray.length, 2);

    const card = {
      name: '沈清秋',
      description: '<style>.x{}</style>角色简介<mvu-status/>',
      personality: '温和',
      scenario: '苍穹山',
      first_mes: '<start><div class="greet">早安，{{user}}。</div></start>',
      alternate_greetings: ['', '  ', '备用：{{char}}看着{{user}}。'],
      mes_example: '',
      system_prompt: '如需要请在每轮更新 mvu_submit_update',
      post_history_instructions: '',
      creator_notes: '',
      character_book: {
        name: '嵌入式世界书',
        extensions: { custom_meta: true },
        entries: {
          '0': {
            comment: '卡内设定',
            enabled: true,
            constant: false,
            keys: ['门派'],
            content: '青云门规',
          },
        },
      },
      extensions: {
        variables: { 灵力: 100 },
        dsh_mvu_conversion: { mode: 'auto' },
      },
    };

    const bundle = extractCardBundle(card, [...wbEntries, ...extraArray]);
    assert.equal(bundle.meta.user, '旅人');
    assert.deepEqual(bundle.greetings, ['早安，旅人。', '备用：沈清秋看着旅人。']);
    assert.ok(!bundle.characterMd.includes('<style>'));
    assert.ok(!bundle.characterMd.includes('<mvu-status'));

    // Constant order: 5 前置常驻 before 20 后置常驻
    assert.ok(bundle.worldbook.always.includes('### 前置常驻\n\n常驻内容A'));
    assert.ok(bundle.worldbook.always.includes('### 后置常驻\n\n常驻内容B'));
    assert.ok(bundle.worldbook.always.indexOf('### 前置常驻') < bundle.worldbook.always.indexOf('### 后置常驻'));

    // Colliding filenames deduplicated with zero-padding; [initvar] & disabled excluded from entries
    assert.equal(bundle.worldbook.entries.length, 3);
    assert.equal(bundle.worldbook.entries[0].filename, '001-卡内设定.md');
    assert.equal(bundle.worldbook.entries[1].filename, '002-foo.md');
    assert.equal(bundle.worldbook.entries[2].filename, '003-foo.md');
    assert.deepEqual(bundle.worldbook.entries[1].keys, ['抽签', '签', '木签', '命运']);
    assert.equal(bundle.worldbook.entries[1].content, '第一条沈清秋与旅人的词条');
    assert.equal(bundle.worldbook.entries[1].chars, bundle.worldbook.entries[1].content.length);
    assert.equal(bundle.worldbook.entries[2].content, '第二条同名词条');

    // Disabled excludes [initvar] (goes to statusCandidates)
    assert.equal(bundle.worldbook.disabled.length, 1);
    assert.equal(bundle.worldbook.disabled[0].title, '废弃旧设定');

    // statusCandidates includes disabled [initvar], extensions.variables, dsh_mvu_conversion, and system_prompt MVU cue
    assert.ok(
      bundle.statusCandidates.some((s) => s.kind === 'mvu' && s.title.includes('[initvar]')),
      'disabled [initvar] should be extracted into statusCandidates'
    );
    assert.ok(bundle.statusCandidates.some((s) => s.kind === 'mvu' && s.source === 'extensions.variables'));
    assert.ok(bundle.statusCandidates.some((s) => s.kind === 'mvu' && s.source === 'extensions.dsh_mvu_conversion'));
    assert.ok(bundle.statusCandidates.some((s) => s.kind === 'mvu' && s.source === 'card.system_prompt'));
  });
});

test('loadCard and extractCardBundle strip megabyte extensions.tavern_helper payloads', () => {
  withTempDir((dir) => {
    const giantScript = '/* MEGA_JS_MARKER */ ' + 'console.log("x");'.repeat(150000); // ~2.5 MB
    const cardPath = path.join(dir, 'giant.json');
    fs.writeFileSync(
      cardPath,
      JSON.stringify({
        spec: 'chara_card_v3',
        data: {
          name: '巨型前端卡',
          description: '干净设定',
          first_mes: '欢迎。',
          extensions: {
            tavern_helper: {
              scripts: [{ name: 'ui', content: giantScript }],
              variables: { secret: giantScript },
            },
          },
        },
      })
    );

    const card = loadCard(cardPath);
    assert.equal(card.extensions.tavern_helper, undefined);
    assert.ok(!JSON.stringify(card).includes('MEGA_JS_MARKER'));

    const bundle = extractCardBundle(card, [], { user: '玩家' });
    const serializedBundle = JSON.stringify(bundle);
    assert.ok(serializedBundle.length < 5000);
    assert.ok(!serializedBundle.includes('MEGA_JS_MARKER'));
  });
});

test('extractCardBundle keeps narrative/negated status mentions in lore while still detecting real status directives', () => {
  const narrativeCard = {
    spec: 'chara_card_v2',
    data: {
      name: '林晚',
      description: '她低头看了一眼手机状态栏上的未读消息。本卡无状态栏，无需状态栏，请不要在回复末尾输出状态栏。',
      personality: '细心',
      scenario: '雨夜便利店',
      first_mes: '手机状态栏亮着微光，不需要状态栏提示也能看清时间，{{user}}。',
      alternate_greetings: ['禁止生成状态栏，这里只聊日常。'],
      character_book: {
        entries: [
          {
            uid: 0,
            comment: '日常物件',
            enabled: true,
            constant: true,
            insertion_order: 1,
            content: '桌面上的手机状态栏显示电量剩 12%，本世界观没有状态栏或属性面板系统。',
          },
          {
            uid: 1,
            comment: '禁止属性面板规则',
            enabled: true,
            constant: false,
            keys: ['面板'],
            content: '游戏内禁止状态栏与不要属性面板弹窗。',
          },
        ],
      },
    },
  };

  const narrativeBundle = extractCardBundle(narrativeCard, [], { user: '旅人' });
  assert.deepEqual(narrativeBundle.statusCandidates, []);
  assert.ok(narrativeBundle.worldbook.always.includes('手机状态栏显示电量剩 12%'));
  assert.equal(narrativeBundle.worldbook.entries.length, 1);
  assert.ok(narrativeBundle.worldbook.entries[0].content.includes('禁止状态栏'));
  assert.ok(narrativeBundle.characterMd.includes('手机状态栏上的未读消息'));
  assert.ok(narrativeBundle.greetings[0].includes('手机状态栏亮着微光'));

  // Positive cases: real fixture PNG + explicit tags + title naming + directive phrasing
  const fixtureBundle = extractCardBundle(loadCard(FIXTURE_PNG), [], { user: '林渊' });
  assert.ok(
    fixtureBundle.statusCandidates.some((s) => s.kind === 'frontend-prompt' && s.title.includes('user状态栏'))
  );

  const directiveCard = {
    name: '测试角色',
    description: '普通描述',
    system_prompt: '正文末尾必须附带状态栏，包含好感度与体力。',
    first_mes: '你好。',
    character_book: {
      entries: [
        {
          uid: 0,
          comment: '属性面板',
          enabled: true,
          constant: true,
          content: '力量：10\n敏捷：12',
        },
        {
          uid: 1,
          comment: '内嵌模板',
          enabled: true,
          constant: false,
          keys: ['状态'],
          content: '状态栏：\n心情：平静',
        },
      ],
    },
  };

  const directiveBundle = extractCardBundle(directiveCard);
  assert.equal(directiveBundle.statusCandidates.length, 3);
  assert.ok(directiveBundle.statusCandidates.every((s) => s.kind === 'frontend-prompt'));
});
