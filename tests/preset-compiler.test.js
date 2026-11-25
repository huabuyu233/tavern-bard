const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolvePromptOrder,
  preparePresetOnImport,
  compilePreset,
  listPresetEntries,
  togglePresetEntries,
} = require('../skill/scripts/lib/preset-compiler');

const MEOWSSIAH_PATH = path.resolve(__dirname, '..', '示例资源', '预设', 'Meowssiah-2.1.6.json');

function loadMeowssiah() {
  return JSON.parse(fs.readFileSync(MEOWSSIAH_PATH, 'utf8'));
}

test('resolvePromptOrder prefers character_id 100001, falls back to last group, and falls back to prompts[].enabled', () => {
  const basePrompts = [
    { identifier: 'p1', name: '第一条', enabled: true, content: '内容1' },
    { identifier: 'p2', name: '第二条', enabled: false, content: '内容2' },
  ];

  // 1. Prefers character_id === 100001 and trusts order[].enabled over prompts[].enabled
  const with100001 = {
    prompts: basePrompts,
    prompt_order: [
      { character_id: 100000, order: [{ identifier: 'p1', enabled: false }] },
      {
        character_id: 100001,
        order: [
          { identifier: 'p2', enabled: true },
          { identifier: 'p1', enabled: false },
        ],
      },
      { character_id: 100002, order: [{ identifier: 'p1', enabled: true }] },
    ],
  };
  const resolved100001 = resolvePromptOrder(with100001);
  assert.deepEqual(
    resolved100001.map((item) => ({ id: item.identifier, enabled: item.enabled, name: item.prompt.name })),
    [
      { id: 'p2', enabled: true, name: '第二条' },
      { id: 'p1', enabled: false, name: '第一条' },
    ]
  );

  // 2. Falls back to last prompt_order group when 100001 is absent
  const without100001 = {
    prompts: basePrompts,
    prompt_order: [
      { character_id: 100000, order: [{ identifier: 'p1', enabled: true }] },
      {
        character_id: 100099,
        order: [
          { identifier: 'p1', enabled: false },
          { identifier: 'p2', enabled: true },
        ],
      },
    ],
  };
  const resolvedLast = resolvePromptOrder(without100001);
  assert.deepEqual(
    resolvedLast.map((item) => ({ id: item.identifier, enabled: item.enabled })),
    [
      { id: 'p1', enabled: false },
      { id: 'p2', enabled: true },
    ]
  );

  // 3. Falls back to prompts[].enabled when prompt_order is missing or empty
  const noOrder = { prompts: basePrompts };
  assert.deepEqual(
    resolvePromptOrder(noOrder).map((item) => ({ id: item.identifier, enabled: item.enabled })),
    [
      { id: 'p1', enabled: true },
      { id: 'p2', enabled: false },
    ]
  );

  const emptyOrder = { prompts: basePrompts, prompt_order: [] };
  assert.deepEqual(
    resolvePromptOrder(emptyOrder).map((item) => ({ id: item.identifier, enabled: true && item.enabled })),
    [
      { id: 'p1', enabled: true },
      { id: 'p2', enabled: false },
    ]
  );

  assert.throws(() => resolvePromptOrder(null), /preset/i);
  assert.throws(() => resolvePromptOrder([]), /preset/i);
});

test('preparePresetOnImport handles real Meowssiah-2.1.6.json safely without losing jailbreak persona or add-ons', () => {
  const original = loadMeowssiah();
  const snapshotBefore = JSON.stringify(original);

  const { sourceJson, autoDisabled, activeMd } = preparePresetOnImport(original, {
    char: '江亦雪',
    user: '陈默',
  });

  // Pure: original input object is not mutated
  assert.equal(JSON.stringify(original), snapshotBefore);

  // Auto-disabled entries include 📏小总结, 📏<game>标签（别关）, and pure thinking-only entries
  const disabledNames = autoDisabled.map((d) => d.name);
  assert.ok(
    autoDisabled.some((d) => d.name === '📏小总结' && d.reason === 'per-turn-summary'),
    `expected 📏小总结 in autoDisabled, got: ${JSON.stringify(autoDisabled)}`
  );
  assert.ok(
    autoDisabled.some((d) => d.name.includes('<game>') && d.reason === 'frontend-wrapper-tag'),
    `expected 📏<game>标签 in autoDisabled, got: ${JSON.stringify(autoDisabled)}`
  );
  assert.ok(
    autoDisabled.some(
      (d) => d.name.includes('token重定义+初始化') && d.reason === 'standalone-thinking-tag'
    ),
    `expected token重定义+初始化 in autoDisabled, got: ${JSON.stringify(autoDisabled)}`
  );
  assert.ok(
    autoDisabled.some(
      (d) => d.name.includes('大思考步骤') && d.reason === 'standalone-thinking-tag'
    ),
    `expected 大思考步骤 in autoDisabled, got: ${JSON.stringify(autoDisabled)}`
  );

  // Must NOT auto-disable jailbreak persona, anti-omniscience, action options, or cat comment
  assert.ok(!disabledNames.some((n) => n.includes('召唤术')));
  assert.ok(!disabledNames.some((n) => n.includes('防全知')));
  assert.ok(!disabledNames.some((n) => n.includes('行动选项')));
  assert.ok(!disabledNames.some((n) => n.includes('猫猫留言')));
  assert.ok(!disabledNames.some((n) => n.includes('历史回顾')));

  // Verify sourceJson recorded the auto-disables in prompt_order and prompts
  const resolvedAfter = resolvePromptOrder(sourceJson);
  for (const item of autoDisabled) {
    const entry = resolvedAfter.find((e) => e.identifier === item.identifier);
    assert.equal(entry.enabled, false, `${item.name} should be disabled in prompt_order`);
    const promptObj = sourceJson.prompts.find((p) => p.identifier === item.identifier);
    assert.equal(promptObj.enabled, false, `${item.name} should be disabled in prompts[]`);
  }

  // Jailbreak persona preserved, fake tool & think_nya clauses stripped
  assert.ok(activeMd.includes('小猫之神'));
  assert.ok(activeMd.includes('互动文字游戏'));
  assert.ok(!activeMd.includes('soliumbra_reply'));
  assert.ok(!activeMd.includes('reply工具'));
  assert.ok(!activeMd.includes('<think_nya>'));
  assert.ok(!activeMd.includes('</think_nya>'));

  // Anti-omniscience prose kept cleanly
  assert.ok(activeMd.includes('避免出现角色知道其视角不可能知道的信息的情况'));

  // Macro expansion applied
  assert.ok(activeMd.includes('陈默'));
  assert.ok(!activeMd.includes('{{user}}'));
  assert.ok(!activeMd.includes('{{char}}'));

  // Enabled end-of-turn add-ons preserved as clean Markdown without raw XML tags
  assert.ok(activeMd.includes('行动选项'));
  assert.ok(activeMd.includes('猫猫留言'));
  assert.ok(!activeMd.includes('<options>'));
  assert.ok(!activeMd.includes('</options>'));
  assert.ok(!activeMd.includes('<option>'));
  assert.ok(!activeMd.includes('</option>'));
  assert.ok(!activeMd.includes('<comment>'));
  assert.ok(!activeMd.includes('</comment>'));
  assert.ok(!activeMd.includes('<game>'));
  assert.ok(!activeMd.includes('</game>'));
  assert.ok(!activeMd.includes('<summary>'));
  assert.ok(!activeMd.includes('</summary>'));
  assert.ok(!activeMd.includes('<<<|catgodml|'));
  assert.ok(!activeMd.includes('{{//'));
  assert.ok(!activeMd.includes('<|sep|>'));
  assert.ok(!activeMd.includes('<|merge|>'));
  assert.ok(!activeMd.includes('<run_tool_replacement>'));

  // Skips marker slots, comment-only entries, comment blocks with nested {{user}}, and orphan slot fragments
  assert.ok(!activeMd.includes('Persona Description'));
  assert.ok(!activeMd.includes('World Info (before)'));
  assert.ok(!activeMd.includes('Chat History'));
  assert.ok(!activeMd.includes('免责声明'));
  assert.ok(!activeMd.includes('惨无人道的欺骗'));
  assert.ok(!activeMd.includes('完全无关'));
  assert.ok(!activeMd.includes('两个杠不要动'));
  assert.ok(activeMd.includes('|用户：陈默|'));
  assert.ok(!activeMd.includes('### 别关'));
  assert.ok(!activeMd.includes('### char'));
  assert.ok(!activeMd.includes('### /char'));
  assert.ok(!activeMd.includes('### 【别关】'));
  assert.ok(!activeMd.includes('<陈默>'));
  assert.ok(!activeMd.includes('</陈默>'));
  assert.ok(!activeMd.includes('<江亦雪>'));
  assert.ok(!activeMd.includes('</江亦雪>'));
});

test('preparePresetOnImport classifies status bars, standalone thinking, drops separators, and groups depth <= 2 prompts', () => {
  const syntheticPreset = {
    prompts: [
      {
        identifier: 'sc-status',
        name: 'SC状态指令',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '请在每次回复末尾输出<StatusBlock>状态栏，包含好感度和体力。',
      },
      {
        identifier: 'mvu-force',
        name: 'MVU强制',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '必须调用 mvu_submit_update 输出状态面板。',
      },
      {
        identifier: 'cot-only',
        name: 'Thinking思维链',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '在正式输出正文之前，请先在<thinking>标签内梳理剧情逻辑：\n1. 人物心理\n2. 下一步行动',
      },
      {
        identifier: 'inner-details',
        name: '内心活动',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '可穿插内心独白：\n<details><summary>内心-江亦雪</summary>\n她表面冷静。\n</details>',
      },
      {
        identifier: 'pure-sep',
        name: '分隔条',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '====================\n---分隔线---',
      },
      {
        identifier: 'orphan-tag',
        name: '孤立标签',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '</{{user}}>\n<{{char}}>',
      },
      {
        identifier: 'core-rule',
        name: '核心文风',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '使用克制细腻的古风叙事，{{char}} 对 {{user}} 保持礼貌疏离。',
      },
      {
        identifier: 'deep-non-urgent',
        name: '远深度条目',
        enabled: true,
        injection_position: 1,
        injection_depth: 4,
        content: '深度为4的条目留在核心规则区。',
      },
      {
        identifier: 'hard-constraint-2',
        name: '防抢话硬约束',
        enabled: true,
        injection_position: 1,
        injection_depth: 2,
        content: '绝对禁止替 {{user}} 决定任何行动或台词。',
      },
      {
        identifier: 'hard-constraint-0',
        name: '结尾格式约束',
        enabled: true,
        injection_position: 1,
        injection_depth: 0,
        content: '保持 {{char}} 第一人称视角，不要出戏。',
      },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'sc-status', enabled: true },
          { identifier: 'mvu-force', enabled: true },
          { identifier: 'cot-only', enabled: true },
          { identifier: 'inner-details', enabled: true },
          { identifier: 'pure-sep', enabled: true },
          { identifier: 'orphan-tag', enabled: true },
          { identifier: 'core-rule', enabled: true },
          { identifier: 'deep-non-urgent', enabled: true },
          { identifier: 'hard-constraint-2', enabled: true },
          { identifier: 'hard-constraint-0', enabled: true },
        ],
      },
    ],
  };

  const { sourceJson, autoDisabled, activeMd } = preparePresetOnImport(syntheticPreset, {
    char: '江亦雪',
    user: '陈默',
  });

  assert.ok(autoDisabled.some((d) => d.identifier === 'sc-status' && d.reason === 'frontend-status-bar'));
  assert.ok(autoDisabled.some((d) => d.identifier === 'mvu-force' && d.reason === 'frontend-status-bar'));
  assert.ok(autoDisabled.some((d) => d.identifier === 'cot-only' && d.reason === 'standalone-thinking-tag'));

  // <details><summary> must NOT be treated as per-turn-summary
  assert.ok(!autoDisabled.some((d) => d.identifier === 'inner-details'));
  assert.ok(activeMd.includes('内心-江亦雪'));

  // Separator and orphan tag entries dropped
  assert.ok(!activeMd.includes('分隔条'));
  assert.ok(!activeMd.includes('孤立标签'));
  assert.ok(!activeMd.includes('===='));

  // Depth-injected prompts (injection_position === 1 && injection_depth <= 2) grouped at the end
  const hardHeadingIdx = activeMd.indexOf('## 每轮落笔前硬约束');
  assert.ok(hardHeadingIdx !== -1, 'expected ## 每轮落笔前硬约束 section');

  const coreIdx = activeMd.indexOf('使用克制细腻的古风叙事');
  const depth4Idx = activeMd.indexOf('深度为4的条目留在核心规则区');
  const hard2Idx = activeMd.indexOf('绝对禁止替 陈默 决定任何行动或台词');
  const hard0Idx = activeMd.indexOf('保持 江亦雪 第一人称视角');

  assert.ok(coreIdx !== -1 && coreIdx < hardHeadingIdx);
  assert.ok(depth4Idx !== -1 && depth4Idx < hardHeadingIdx);
  assert.ok(hard2Idx > hardHeadingIdx);
  assert.ok(hard0Idx > hardHeadingIdx);

  // Compile idempotency
  const recompiled = compilePreset(sourceJson, {}, { char: '江亦雪', user: '陈默' });
  assert.equal(recompiled, activeMd);
});

test('listPresetEntries, togglePresetEntries, and compilePreset with overrides work seamlessly', () => {
  const preset = {
    prompts: [
      { identifier: 'marker-slot', name: 'Chat History', marker: true, enabled: true, content: '' },
      {
        identifier: 'enhanceDefinitions',
        name: '召唤术',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '原始文本：使用soliumbra_reply回复。保留{{char}}破限设定。',
      },
      {
        identifier: 'asmr-opt',
        name: '❤️ASMR对话',
        enabled: false,
        injection_position: 0,
        injection_depth: 4,
        content: '启用亲密ASMR语气，{{user}} 会听到低语。',
      },
      {
        identifier: 'cat-comment',
        name: '📏猫猫留言~',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        content: '你可以在<comment></comment>里留言',
      },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'marker-slot', enabled: true },
          { identifier: 'enhanceDefinitions', enabled: true },
          { identifier: 'asmr-opt', enabled: false },
          { identifier: 'cat-comment', enabled: true },
        ],
      },
    ],
  };

  // listPresetEntries returns 1-based index and accurate metadata
  const listed = listPresetEntries(preset);
  assert.deepEqual(listed, [
    { index: 1, identifier: 'marker-slot', name: 'Chat History', enabled: true, marker: true, chars: 0 },
    {
      index: 2,
      identifier: 'enhanceDefinitions',
      name: '召唤术',
      enabled: true,
      marker: false,
      chars: preset.prompts[1].content.length,
    },
    {
      index: 3,
      identifier: 'asmr-opt',
      name: '❤️ASMR对话',
      enabled: false,
      marker: false,
      chars: preset.prompts[2].content.length,
    },
    {
      index: 4,
      identifier: 'cat-comment',
      name: '📏猫猫留言~',
      enabled: true,
      marker: false,
      chars: preset.prompts[3].content.length,
    },
  ]);

  // togglePresetEntries matches by 1-based index, exact identifier, and case-insensitive substring
  const originalSnap = JSON.stringify(preset);
  const { sourceJson: toggled1, changed: changed1 } = togglePresetEntries(preset, {
    enable: ['asmr'],
    disable: ['4'],
  });
  assert.equal(JSON.stringify(preset), originalSnap); // pure
  assert.deepEqual(changed1, [
    { identifier: 'asmr-opt', name: '❤️ASMR对话', enabled: true },
    { identifier: 'cat-comment', name: '📏猫猫留言~', enabled: false },
  ]);

  // Both prompt_order and prompts[].enabled are updated
  const orderGroup = toggled1.prompt_order.find((g) => g.character_id === 100001);
  assert.equal(orderGroup.order.find((o) => o.identifier === 'asmr-opt').enabled, true);
  assert.equal(orderGroup.order.find((o) => o.identifier === 'cat-comment').enabled, false);
  assert.equal(toggled1.prompts.find((p) => p.identifier === 'asmr-opt').enabled, true);
  assert.equal(toggled1.prompts.find((p) => p.identifier === 'cat-comment').enabled, false);

  // Toggle by exact identifier
  const { sourceJson: toggled2, changed: changed2 } = togglePresetEntries(toggled1, {
    disable: ['enhanceDefinitions'],
  });
  assert.deepEqual(changed2, [{ identifier: 'enhanceDefinitions', name: '召唤术', enabled: false }]);
  assert.equal(toggled2.prompts.find((p) => p.identifier === 'enhanceDefinitions').enabled, false);

  // Re-enable by index '2' and compile with overrides.json overlay (macros expanded AFTER override lookup!)
  const { sourceJson: toggled3 } = togglePresetEntries(toggled2, { enable: ['2'] });
  const overrides = {
    enhanceDefinitions: '语义覆写：{{char}} 全权担任 {{user}} 的专属故事主持。',
  };
  const compiled = compilePreset(toggled3, overrides, { char: '江亦雪', user: '陈默' });

  assert.ok(compiled.includes('语义覆写：江亦雪 全权担任 陈默 的专属故事主持。'));
  assert.ok(!compiled.includes('原始文本'));
  assert.ok(compiled.includes('启用亲密ASMR语气，陈默 会听到低语。'));
  assert.ok(!compiled.includes('猫猫留言'));
});
