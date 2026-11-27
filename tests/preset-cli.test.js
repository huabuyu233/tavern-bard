const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INIT_SCRIPT = path.join(REPO_ROOT, 'skill', 'scripts', 'init.js');
const PRESET_SCRIPT = path.join(REPO_ROOT, 'skill', 'scripts', 'preset.js');
const FIXTURE_PNG = path.join(
  REPO_ROOT,
  '示例资源',
  '角色卡',
  'user可以为所欲为，char无条件包容user一切言行，并视为理所当然的平然世界.png'
);
const FIXTURE_PRESET = path.join(REPO_ROOT, '示例资源', '预设', 'Meowssiah-2.1.6.json');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-bard-preset-cli-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runPresetCli(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [PRESET_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('preset.js list outputs [x]/[ ] table and toggle updates source.json & active.md while preserving overrides.json', () => {
  withTempDir((dir) => {
    const initRes = spawnSync(
      process.execPath,
      [INIT_SCRIPT, '--card', FIXTURE_PNG, '--preset', FIXTURE_PRESET, '--user', '林渊', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    assert.equal(initRes.status, 0, initRes.stderr);

    // 1. list
    const listRes = runPresetCli(['list', '--dir', dir]);
    assert.equal(listRes.status, 0, listRes.stderr);
    assert.match(listRes.stdout, /\[x\]/);
    assert.match(listRes.stdout, /\[ \]/);
    assert.match(listRes.stdout, /猫猫留言/);
    assert.match(listRes.stdout, /小总结/);

    // 2. Write custom overrides.json for enhanceDefinitions before toggling another entry
    const overridesPath = path.join(dir, 'preset', 'overrides.json');
    const overridesData = {
      enhanceDefinitions: '自定义语义覆写：{{char}} 与 {{user}} 在终端剧场相遇。',
    };
    fs.writeFileSync(overridesPath, JSON.stringify(overridesData, null, 2), 'utf8');

    // 3. toggle --disable "猫猫留言"
    const toggleRes = runPresetCli(['toggle', '--disable', '猫猫留言', '--dir', dir]);
    assert.equal(toggleRes.status, 0, toggleRes.stderr);

    const updatedSource = JSON.parse(fs.readFileSync(path.join(dir, 'preset', 'source.json'), 'utf8'));
    const catPrompt = updatedSource.prompts.find((p) => p.name && p.name.includes('猫猫留言'));
    assert.equal(catPrompt.enabled, false);
    const orderGroup = updatedSource.prompt_order.find((g) => g.character_id === 100001);
    const catOrder = orderGroup.order.find((o) => o.identifier === catPrompt.identifier);
    assert.equal(catOrder.enabled, false);

    // active.md removes 猫猫留言 and applies overrides.json with campaign.json { char, user }
    const activeMd = fs.readFileSync(path.join(dir, 'preset', 'active.md'), 'utf8');
    assert.ok(!activeMd.includes('猫猫留言'), 'disabled 猫猫留言 must be removed from active.md');
    assert.ok(
      activeMd.includes('自定义语义覆写：角煮风格平然色情-1115 与 林渊 在终端剧场相遇。'),
      'overrides.json must remain applied with campaign vars after toggle'
    );

    // overrides.json preserved untouched
    assert.deepEqual(JSON.parse(fs.readFileSync(overridesPath, 'utf8')), overridesData);

    // list reflects disabled state
    const listAfter = runPresetCli(['list', '--dir', dir]);
    assert.equal(listAfter.status, 0);
    const catLine = listAfter.stdout.split(/\r?\n/).find((line) => line.includes('猫猫留言'));
    assert.ok(catLine && catLine.includes('[ ]'), `expected 猫猫留言 to show [ ], got: ${catLine}`);
  });
});

test('preset.js supports repeated --enable/--disable flags and compile falls back when campaign.json is absent', () => {
  withTempDir((dir) => {
    const presetDir = path.join(dir, 'preset');
    fs.mkdirSync(presetDir, { recursive: true });

    const sourcePreset = {
      prompts: [
        { identifier: 'a', name: '规则A', enabled: false, content: '启用A：{{char}} 照顾 {{user}}。' },
        { identifier: 'b', name: '规则B', enabled: false, content: '启用B：保持细节。' },
        { identifier: 'c', name: '规则C', enabled: true, content: '禁用C：不应再出现。' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'a', enabled: false },
            { identifier: 'b', enabled: false },
            { identifier: 'c', enabled: true },
          ],
        },
      ],
    };
    fs.writeFileSync(path.join(presetDir, 'source.json'), JSON.stringify(sourcePreset, null, 2), 'utf8');

    // Repeated --enable and --disable without campaign.json
    const toggleRes = runPresetCli([
      'toggle',
      '--enable',
      '规则A',
      '--enable',
      '规则B',
      '--disable',
      '规则C',
      '--dir',
      dir,
    ]);
    assert.equal(toggleRes.status, 0, toggleRes.stderr);

    const compiledAfterToggle = fs.readFileSync(path.join(presetDir, 'active.md'), 'utf8');
    assert.ok(compiledAfterToggle.includes('启用A：Character 照顾 旅人。'));
    assert.ok(compiledAfterToggle.includes('启用B：保持细节。'));
    assert.ok(!compiledAfterToggle.includes('禁用C'));

    // Explicit compile command also works cleanly
    fs.writeFileSync(
      path.join(presetDir, 'overrides.json'),
      JSON.stringify({ b: '覆写B：{{user}} 的视角保持克制。' }),
      'utf8'
    );
    const compileRes = runPresetCli(['compile', '--dir', dir]);
    assert.equal(compileRes.status, 0, compileRes.stderr);
    const compiledAfterCompile = fs.readFileSync(path.join(presetDir, 'active.md'), 'utf8');
    assert.ok(compiledAfterCompile.includes('覆写B：旅人 的视角保持克制。'));
  });
});

test('preset.js --help exits 0 and missing preset/source.json exits non-zero', () => {
  const helpRes = runPresetCli(['--help']);
  assert.equal(helpRes.status, 0);
  assert.match(helpRes.stdout, /list/);
  assert.match(helpRes.stdout, /toggle/);
  assert.match(helpRes.stdout, /compile/);

  withTempDir((emptyDir) => {
    const errRes = runPresetCli(['list', '--dir', emptyDir]);
    assert.notEqual(errRes.status, 0);
    assert.match(`${errRes.stdout}\n${errRes.stderr}`, /source\.json/i);
  });
});

test('preset.js toggle does not rewrite preset/source.json when changed.length === 0', () => {
  withTempDir((dir) => {
    const presetDir = path.join(dir, 'preset');
    fs.mkdirSync(presetDir, { recursive: true });

    const sourcePreset = {
      prompts: [
        { identifier: 'a', name: '规则A', enabled: true, content: '已启用的规则A。' },
      ],
      prompt_order: [
        { character_id: 100001, order: [{ identifier: 'a', enabled: true }] },
      ],
    };

    // Write compact single-line JSON with an explicit historical mtime to detect unnecessary rewrites
    const compactRaw = JSON.stringify(sourcePreset);
    const sourcePath = path.join(presetDir, 'source.json');
    fs.writeFileSync(sourcePath, compactRaw, 'utf8');
    const oldTime = new Date(Date.now() - 120000);
    fs.utimesSync(sourcePath, oldTime, oldTime);
    const beforeMtimeMs = fs.statSync(sourcePath).mtimeMs;

    const noopRes = runPresetCli(['toggle', '--enable', '规则A', '--dir', dir]);
    assert.equal(noopRes.status, 0, noopRes.stderr);
    assert.match(noopRes.stdout, /No preset entries changed/);

    const afterRaw = fs.readFileSync(sourcePath, 'utf8');
    const afterMtimeMs = fs.statSync(sourcePath).mtimeMs;
    assert.equal(afterRaw, compactRaw, 'no-op toggle must not rewrite preset/source.json bytes');
    assert.equal(afterMtimeMs, beforeMtimeMs, 'no-op toggle must not modify preset/source.json mtime');
    assert.ok(fs.readFileSync(path.join(presetDir, 'active.md'), 'utf8').includes('已启用的规则A。'));
  });
});
