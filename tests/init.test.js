const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INIT_SCRIPT = path.join(REPO_ROOT, 'skill', 'scripts', 'init.js');
const FIXTURE_PNG = path.join(
  REPO_ROOT,
  '示例资源',
  '角色卡',
  'user可以为所欲为，char无条件包容user一切言行，并视为理所当然的平然世界.png'
);
const FIXTURE_PRESET = path.join(REPO_ROOT, '示例资源', '预设', 'Meowssiah-2.1.6.json');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-bard-init-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runInitCli(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [INIT_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('init.js aborts with exit code 2 when target dir is non-empty without campaign.json unless --force is passed', () => {
  withTempDir((dir) => {
    const readmePath = path.join(dir, 'README.md');
    fs.writeFileSync(readmePath, '# Existing Project\n', 'utf8');

    const res = runInitCli(['--card', FIXTURE_PNG, '--dir', dir]);
    assert.equal(res.status, 2, `expected exit 2, got ${res.status}; stderr: ${res.stderr}`);
    const combinedOutput = `${res.stdout}\n${res.stderr}`;
    assert.match(combinedOutput, /non-empty|非空/i);
    assert.match(combinedOutput, /--force/);
    assert.match(combinedOutput, /--dir/);

    assert.equal(fs.existsSync(path.join(dir, 'campaign.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
    assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
    assert.equal(fs.readFileSync(readmePath, 'utf8'), '# Existing Project\n');

    // Even a directory containing only .git (without campaign.json) must be protected
    withTempDir((gitRepoDir) => {
      fs.mkdirSync(path.join(gitRepoDir, '.git'));
      const gitRes = runInitCli(['--card', FIXTURE_PNG, '--dir', gitRepoDir]);
      assert.equal(gitRes.status, 2);
      assert.equal(fs.existsSync(path.join(gitRepoDir, 'campaign.json')), false);
    });

    // With --force, initialization proceeds cleanly while preserving README.md
    const forced = runInitCli(['--card', FIXTURE_PNG, '--dir', dir, '--force']);
    assert.equal(forced.status, 0, `expected exit 0 with --force, stderr: ${forced.stderr}`);
    assert.equal(fs.existsSync(path.join(dir, 'campaign.json')), true);
    assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), true);
    assert.equal(fs.readFileSync(readmePath, 'utf8'), '# Existing Project\n');
  });
});

test('init.js initializes real PNG card and Meowssiah preset into an empty directory', () => {
  withTempDir((dir) => {
    const customSkillDir = path.join(os.tmpdir(), 'custom-tavern-skill');
    const res = runInitCli([
      '--card',
      FIXTURE_PNG,
      '--preset',
      FIXTURE_PRESET,
      '--user',
      '林渊',
      '--dir',
      dir,
      '--skill-dir',
      customSkillDir,
    ]);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);

    // AGENTS.md & CLAUDE.md
    const claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.equal(claudeMd, '@AGENTS.md\n');

    const agentsMd = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agentsMd, /角煮风格平然色情-1115/);
    assert.match(agentsMd, /林渊/);
    assert.match(agentsMd, /tavern-bard/);
    assert.match(agentsMd, /SKILL\.md/);
    assert.ok(agentsMd.includes(customSkillDir));
    assert.match(agentsMd, /memory\/summary\/facts\.md/);
    assert.match(agentsMd, /memory\/full\//);
    assert.match(agentsMd, /Zero OOC|严禁出戏/);
    assert.match(agentsMd, /User Agency|严禁越界代演/);
    assert.match(agentsMd, /Clean Prose|严禁正文污染/);

    // campaign.json
    const campaign = JSON.parse(fs.readFileSync(path.join(dir, 'campaign.json'), 'utf8'));
    assert.equal(campaign.char, '角煮风格平然色情-1115');
    assert.equal(campaign.user, '林渊');
    assert.equal(campaign.hasStatus, false);
    assert.equal(campaign.hasStatusCandidates, true);
    assert.equal(campaign.hasPreset, true);
    assert.equal(campaign.currentChapter, 1);
    assert.equal(campaign.currentTurn, 0);
    assert.ok(!Number.isNaN(Date.parse(campaign.createdAt)), 'createdAt should be valid ISO timestamp');
    assert.equal(campaign.cardSource, path.basename(FIXTURE_PNG));
    assert.equal(campaign.presetSource, 'Meowssiah-2.1.6.json');

    // card/
    const characterMd = fs.readFileSync(path.join(dir, 'card', 'character.md'), 'utf8');
    assert.match(characterMd, /^# 角煮风格平然色情-1115/m);
    const greeting1 = fs.readFileSync(path.join(dir, 'card', 'greetings', 'greeting-01.md'), 'utf8');
    assert.match(greeting1, /林渊/);
    assert.ok(!greeting1.includes('{{user}}'));

    // worldbook/
    const alwaysMd = fs.readFileSync(path.join(dir, 'worldbook', 'always.md'), 'utf8');
    assert.match(alwaysMd, /### 平然色情/);
    assert.match(alwaysMd, /### 指导/);
    assert.ok(!alwaysMd.includes('<StatusBlock_format>'));
    assert.equal(fs.existsSync(path.join(dir, 'worldbook', 'index.md')), true);
    assert.equal(fs.statSync(path.join(dir, 'worldbook', 'entries')).isDirectory(), true);
    assert.equal(fs.statSync(path.join(dir, 'worldbook', 'disabled')).isDirectory(), true);

    // preset/
    const sourcePreset = JSON.parse(fs.readFileSync(path.join(dir, 'preset', 'source.json'), 'utf8'));
    assert.ok(Array.isArray(sourcePreset.prompts));
    const activeMd = fs.readFileSync(path.join(dir, 'preset', 'active.md'), 'utf8');
    assert.ok(activeMd.includes('小猫之神'));
    assert.ok(!activeMd.includes('<<<|catgodml|'));
    assert.ok(!activeMd.includes('soliumbra_reply'));

    // status/_raw_candidates.md (and NO state.json yet)
    const rawCandidates = fs.readFileSync(path.join(dir, 'status', '_raw_candidates.md'), 'utf8');
    assert.ok(rawCandidates.includes('user状态栏'));
    assert.ok(rawCandidates.includes('<StatusBlock_format>'));
    assert.equal(fs.existsSync(path.join(dir, 'state.json')), false);

    // memory/
    const factsMd = fs.readFileSync(path.join(dir, 'memory', 'summary', 'facts.md'), 'utf8');
    assert.match(factsMd, /# 核心事实表 \(Facts\)/);
    assert.match(factsMd, /## 人物关系与印象/);
    assert.match(factsMd, /## 关键物品与状态/);
    assert.match(factsMd, /## 约定与未解伏笔/);
    assert.equal(fs.existsSync(path.join(dir, 'memory', 'summary', 'scenes.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'memory', 'summary', 'arcs.md')), true);
    const ch1Md = fs.readFileSync(path.join(dir, 'memory', 'full', 'chapter-01.md'), 'utf8');
    assert.match(ch1Md, /^# Chapter 01/m);
  });
});

test('init.js handles card without status bar, multiple worldbooks, alternate greetings, and programmatic initWorkspace', () => {
  const { initWorkspace } = require('../skill/scripts/init');

  withTempDir((dir) => {
    const fixtureDir = path.join(dir, 'fixtures');
    const campaignDir = path.join(dir, 'campaign');
    fs.mkdirSync(fixtureDir);
    fs.mkdirSync(campaignDir);

    const cardPath = path.join(fixtureDir, 'clean-card.json');
    fs.writeFileSync(
      cardPath,
      JSON.stringify({
        spec: 'chara_card_v2',
        data: {
          name: '沈清秋',
          description: '温和的苍穹山峰主，对{{user}}照顾有加。',
          personality: '冷静克制',
          scenario: '竹舍午后',
          first_mes: '早安，{{user}}。',
          alternate_greetings: ['夜深了，{{user}}还不歇息？'],
          mes_example: '',
        },
      }),
      'utf8'
    );

    const wb1Path = path.join(fixtureDir, 'wb1.json');
    fs.writeFileSync(
      wb1Path,
      JSON.stringify({
        entries: {
          '0': {
            comment: '苍穹山',
            enabled: true,
            constant: false,
            keys: ['苍穹山，清静峰'],
            content: '十二峰之一，{{char}}所居。',
          },
          '1': {
            comment: '废弃线',
            enabled: false,
            keys: ['废案'],
            content: '未启用的旧设定',
          },
        },
      }),
      'utf8'
    );

    const wb2Path = path.join(fixtureDir, 'wb2.json');
    fs.writeFileSync(
      wb2Path,
      JSON.stringify([
        {
          comment: '修为体系',
          enabled: true,
          constant: true,
          insertion_order: 10,
          content: '筑基、金丹、元婴。',
        },
        {
          comment: '灵剑|寒霜',
          enabled: true,
          constant: false,
          keys: ['灵剑', '寒霜'],
          content: '一柄佩剑。',
        },
      ]),
      'utf8'
    );

    const res = runInitCli([
      '--card',
      cardPath,
      '--worldbook',
      wb1Path,
      '--worldbook',
      wb2Path,
      '--dir',
      campaignDir,
    ]);
    assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);

    // NO status/ directory and NO state.json
    assert.equal(fs.existsSync(path.join(campaignDir, 'status')), false);
    assert.equal(fs.existsSync(path.join(campaignDir, 'state.json')), false);
    assert.equal(fs.existsSync(path.join(campaignDir, 'preset')), false);

    const campaign = JSON.parse(fs.readFileSync(path.join(campaignDir, 'campaign.json'), 'utf8'));
    assert.equal(campaign.char, '沈清秋');
    assert.equal(campaign.user, '旅人');
    assert.equal(campaign.hasStatus, false);
    assert.equal(campaign.hasStatusCandidates, false);
    assert.equal(campaign.hasPreset, false);
    assert.equal(campaign.presetSource, null);

    // Greetings 01 & 02
    assert.match(fs.readFileSync(path.join(campaignDir, 'card', 'greetings', 'greeting-01.md'), 'utf8'), /早安，旅人。/);
    assert.match(
      fs.readFileSync(path.join(campaignDir, 'card', 'greetings', 'greeting-02.md'), 'utf8'),
      /夜深了，旅人还不歇息？/
    );

    // Worldbook index, entries, disabled, always
    const alwaysMd = fs.readFileSync(path.join(campaignDir, 'worldbook', 'always.md'), 'utf8');
    assert.match(alwaysMd, /修为体系/);
    const indexMd = fs.readFileSync(path.join(campaignDir, 'worldbook', 'index.md'), 'utf8');
    assert.match(indexMd, /\| 文件 \| 标题 \| 触发词 \| 字数 \|/);
    assert.match(indexMd, /001-苍穹山\.md/);
    assert.match(indexMd, /002-灵剑-寒霜\.md/);
    assert.match(indexMd, /灵剑\\\|寒霜/); // pipe escaped cleanly in markdown table
    assert.equal(fs.existsSync(path.join(campaignDir, 'worldbook', 'entries', '001-苍穹山.md')), true);
    assert.equal(fs.existsSync(path.join(campaignDir, 'worldbook', 'disabled', '001-废弃线.md')), true);

    // Re-running in an existing campaign dir (with existing memory) succeeds without --force and preserves memory
    const ch1Path = path.join(campaignDir, 'memory', 'full', 'chapter-01.md');
    fs.appendFileSync(ch1Path, '\n## Turn 1\n玩家：你好。\n', 'utf8');
    const rerunResult = initWorkspace({
      cardPath,
      dir: campaignDir,
    });
    assert.equal(rerunResult.campaign.char, '沈清秋');
    assert.match(fs.readFileSync(ch1Path, 'utf8'), /## Turn 1/);
  });
});

test('init.js --help prints usage and exits 0', () => {
  const res = runInitCli(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--card/);
  assert.match(res.stdout, /--preset/);
  assert.match(res.stdout, /--worldbook/);
  assert.match(res.stdout, /--dir/);
  assert.match(res.stdout, /--force/);
});

test('init.js creates empty greetings/ and index note when card has no greetings or keyword worldbooks', () => {
  withTempDir((dir) => {
    const cardPath = path.join(dir, 'minimal.json');
    const targetDir = path.join(dir, 'out');
    fs.writeFileSync(cardPath, JSON.stringify({ name: '空卡', description: '纯描述' }), 'utf8');

    const res = runInitCli(['--card', cardPath, '--dir', targetDir]);
    assert.equal(res.status, 0, res.stderr);

    const greetingsDir = path.join(targetDir, 'card', 'greetings');
    assert.equal(fs.statSync(greetingsDir).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(greetingsDir), []);

    const indexMd = fs.readFileSync(path.join(targetDir, 'worldbook', 'index.md'), 'utf8');
    assert.match(indexMd, /当前无按需触发词条/);
    const alwaysMd = fs.readFileSync(path.join(targetDir, 'worldbook', 'always.md'), 'utf8');
    assert.match(alwaysMd, /当前无常驻世界书条目/);
  });
});
