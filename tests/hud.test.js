const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HUD_SCRIPT = path.join(REPO_ROOT, 'skill', 'scripts', 'hud.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-bard-hud-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

test('computeDiffs and renderState skip internal keys starting with $ or _ at all levels', () => {
  const { computeDiffs, renderState } = require('../skill/scripts/hud');

  const prev = {
    $meta: { turn: 1 },
    _secret: 'old',
    好感度: 50,
    NPC: {
      $__META_EXTENSIBLE__$: true,
      _id: 'npc-1',
      心情: '平静',
    },
  };

  const curr = {
    $meta: { turn: 2, hiddenToken: 'SECRET_META' },
    _secret: 'SECRET_UNDERSCORE',
    好感度: 55,
    NPC: {
      $__META_EXTENSIBLE__$: false,
      _id: 'npc-2',
      _hiddenNote: 'SECRET_NESTED',
      心情: '愉悦',
    },
  };

  const diffs = computeDiffs(curr, prev);
  assert.equal(diffs.has('$meta'), false);
  assert.equal(diffs.has('$meta.turn'), false);
  assert.equal(diffs.has('_secret'), false);
  assert.equal(diffs.has('NPC.$__META_EXTENSIBLE__$'), false);
  assert.equal(diffs.has('NPC._id'), false);
  assert.equal(diffs.has('NPC._hiddenNote'), false);
  assert.deepEqual(diffs.get('好感度'), { type: 'delta', delta: 5, prev: 50 });
  assert.deepEqual(diffs.get('NPC.心情'), { type: 'changed', prev: '平静' });

  const rendered = renderState(curr, prev, { color: false, width: 64 });
  assert.ok(!rendered.includes('$meta'));
  assert.ok(!rendered.includes('SECRET_META'));
  assert.ok(!rendered.includes('_secret'));
  assert.ok(!rendered.includes('SECRET_UNDERSCORE'));
  assert.ok(!rendered.includes('$__META_EXTENSIBLE__$'));
  assert.ok(!rendered.includes('SECRET_NESTED'));
  assert.ok(rendered.includes('好感度'));
  assert.ok(rendered.includes('愉悦'));
});

test('renderState renders flat scalars, nested sections, { 状态, 详情 } pairs, progress bars, and array chips', () => {
  const { renderState } = require('../skill/scripts/hud');

  const state = {
    当前回合: 7,
    金币: 320,
    世界: {
      时间: '深秋子夜',
      地点: '青石镇旧驿站',
      环境: {
        天气: '细雨',
      },
    },
    user: {
      体力: '20/100',
      状态: ['寒冷', '警戒'],
      负重百分比: '75%',
    },
    林霜: {
      好感度: 60,
      心境: {
        状态: '戒备',
        详情: '表面波澜不惊，指尖却悄然搭在剑柄之上。',
      },
    },
  };

  const out = renderState(state, null, { color: false, width: 68, title: '林霜 × 旅人' });

  // Title & flat scalars
  assert.ok(out.includes('林霜 × 旅人'));
  assert.match(out, /当前回合:\s*7/);
  assert.match(out, /金币:\s*320/);

  // Nested sections including depth > 1
  assert.ok(out.includes('世界'));
  assert.ok(out.includes('深秋子夜'));
  assert.ok(out.includes('青石镇旧驿站'));
  assert.ok(out.includes('▸ 环境'));
  assert.ok(!out.includes('├─ 环境'));
  assert.match(out, /│ {3}天气: 细雨/);

  // Progress bars for 好感度: 60, 体力: "20/100", 75% (not on 金币: 320)
  const lines = out.split(/\r?\n/);
  const affectionLine = lines.find((l) => l.includes('好感度'));
  const staminaLine = lines.find((l) => l.includes('体力'));
  const percentLine = lines.find((l) => l.includes('负重百分比'));
  const goldLine = lines.find((l) => l.includes('金币'));
  assert.ok(affectionLine && /[█░]/.test(affectionLine) && affectionLine.includes('60'), affectionLine);
  assert.ok(staminaLine && /[█░]/.test(staminaLine) && staminaLine.includes('20/100'), staminaLine);
  assert.ok(percentLine && /[█░]/.test(percentLine) && percentLine.includes('75%'), percentLine);
  assert.ok(goldLine && !/[█░]/.test(goldLine), `plain count 金币 should not render progress bar: ${goldLine}`);

  // Short array chips
  assert.ok(out.includes('[寒冷]') && out.includes('[警戒]'));

  // { 状态, 详情 } pair
  assert.ok(out.includes('心境'));
  assert.ok(out.includes('戒备'));
  assert.ok(out.includes('表面波澜不惊，指尖却悄然搭在剑柄之上。'));
});

test('computeDiffs + renderState displays numeric delta (+5, -10) and text change indicator (↑)', () => {
  const { computeDiffs, renderState } = require('../skill/scripts/hud');

  const prevState = {
    好感度: 60,
    精神: 90,
    user: {
      体力: '30/100',
      位置: '城门外',
    },
    林霜: {
      心情: {
        状态: '冷淡',
        详情: '保持安全距离。',
      },
    },
  };

  const currState = {
    好感度: 65,
    精神: 80,
    user: {
      体力: '20/100',
      位置: '驿站大堂',
    },
    林霜: {
      心情: {
        状态: '动摇',
        详情: '眼神微微闪躲。',
      },
      新羁绊: '同行',
    },
  };

  // Null prevState produces empty diff map
  assert.equal(computeDiffs(currState, null).size, 0);

  const diffs = computeDiffs(currState, prevState);
  assert.deepEqual(diffs.get('好感度'), { type: 'delta', delta: 5, prev: 60 });
  assert.deepEqual(diffs.get('精神'), { type: 'delta', delta: -10, prev: 90 });
  assert.deepEqual(diffs.get('user.体力'), { type: 'delta', delta: -10, prev: '30/100' });
  assert.deepEqual(diffs.get('user.位置'), { type: 'changed', prev: '城门外' });
  assert.deepEqual(diffs.get('林霜.心情.状态'), { type: 'changed', prev: '冷淡' });
  assert.deepEqual(diffs.get('林霜.新羁绊'), { type: 'added' });

  const out = renderState(currState, prevState, { color: false, width: 64 });
  assert.ok(out.includes('+5'), `expected +5 in:\n${out}`);
  assert.ok(out.includes('-10'), `expected -10 in:\n${out}`);
  assert.ok(out.includes('↑'), `expected ↑ in:\n${out}`);
});

test('displayWidth and CJK double-width wrapping keep exact borders on narrow width (44 and 28)', () => {
  const { renderState, displayWidth } = require('../skill/scripts/hud');

  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('\x1b[32m中文abc\x1b[0m'), 7);
  assert.equal(displayWidth('（测试），！'), 12);

  const prevState = {
    世界: {
      当前局势: '旧局势',
    },
  };

  const state = {
    世界: {
      当前局势: '这是一段很长很长的中文描述，包含全角标点符号（例如括号、逗号）以及EnglishWords123用来测试窄终端折行时边框是否依然绝对对齐！',
      标签: ['冷静沉着', '高度警戒', '体力透支', '暴雨夜行', '隐藏任务进行中'],
    },
    新加入超长章节名称测试区域: {
      好感度: 85,
      体力: '20/100',
      心境: {
        状态: '紧绷且疑惑',
        详情: '雨水顺着屋檐不断滴落在青石板上，前方雾气弥漫看不清来人的轮廓。',
      },
      物品栏: [
        { 名称: '青霜剑', 数量: 1 },
        { 名称: '止血散', 数量: 3 },
      ],
    },
  };

  for (const width of [44, 28]) {
    for (const color of [false, true]) {
      const rendered = renderState(state, prevState, { width, color, title: '🎭 长标题角色名 × 玩家名测试' });
      const lines = rendered.split(/\r?\n/).filter((line) => line.length > 0);
      assert.ok(lines.length >= 6);

      for (const line of lines) {
        const plain = stripAnsi(line);
        assert.equal(
          displayWidth(plain),
          width,
          `line width mismatch at width=${width}, color=${color}: got ${displayWidth(plain)} for "${plain}"`
        );
        // Verify ANSI codes don't bleed past line end when color=true
        if (color && line.includes('\x1b[')) {
          assert.ok(line.endsWith('\x1b[0m') || !line.match(/\x1b\[[0-9;]*m[^│╯╮]*$/), `unclosed ANSI in: ${JSON.stringify(line)}`);
        }
      }
    }
  }

  // Empty or metadata-only state still renders a valid closed box
  const emptyOut = renderState({ $meta: { v: 1 }, _internal: true }, null, { color: false, width: 44 });
  assert.match(emptyOut, /暂无可显示/);
  for (const line of emptyOut.split(/\r?\n/).filter(Boolean)) {
    assert.equal(displayWidth(line), 44);
  }
});

test('renderState normalizes CRLF/CR/TAB and strips ANSI/C0/C1 control chars from untrusted keys and strings', () => {
  const { renderState, displayWidth } = require('../skill/scripts/hud');

  const dirtyState = {
    '危险\r\n键\t名\b\x1b[31m': '第一行\r\n第二行\r第三行\t缩进\b\x1b[31m红字\x1b[0m\x7f\x9b',
    '区块\r标题\x1b[33m': {
      心境: {
        状态: '冷静\b\x1b[32m',
        详情: '甲\r\n乙\r丙\t丁\x1b]0;evil\x07',
      },
      标签: ['tag\r\n1', 'tag\t2\b\x1b[31m'],
    },
  };

  const rendered = renderState(dirtyState, null, {
    color: false,
    width: 44,
    title: '标题\r\n测试\t\b\x1b[35m',
  });

  assert.equal(rendered.includes('\r'), false, 'rendered output must not contain bare CR');
  assert.equal(rendered.includes('\b'), false, 'rendered output must not contain backspace');
  assert.equal(rendered.includes('\x1b'), false, 'rendered output must not contain raw ESC');
  assert.equal(rendered.includes('[31m'), false, 'injected CSI sequence must be stripped cleanly');
  assert.equal(rendered.includes('\x7f'), false, 'rendered output must not contain DEL');
  assert.equal(rendered.includes('\x9b'), false, 'rendered output must not contain C1 control chars');
  assert.ok(rendered.includes('第一行'));
  assert.ok(rendered.includes('第二行'));
  assert.ok(rendered.includes('第三行'));
  assert.ok(rendered.includes('红字'));

  const lines = rendered.split('\n').filter((line) => line.length > 0);
  assert.ok(lines.length >= 6);
  for (const line of lines) {
    assert.equal(
      displayWidth(line),
      44,
      `line width mismatch after control-char sanitization: got ${displayWidth(line)} for "${line}"`
    );
  }
});

test('safeReadJson handles mid-write truncated/corrupt JSON gracefully and updates when valid JSON lands', () => {
  const { safeReadJson } = require('../skill/scripts/hud');

  withTempDir((dir) => {
    const statePath = path.join(dir, 'state.json');
    const lastValid = { 好感度: 50, 天气: '晴' };

    // Missing file returns lastValid
    assert.deepEqual(safeReadJson(statePath, lastValid), lastValid);
    assert.equal(safeReadJson(statePath, null), null);

    // Empty file mid-truncate returns lastValid
    fs.writeFileSync(statePath, '', 'utf8');
    assert.deepEqual(safeReadJson(statePath, lastValid), lastValid);

    // Truncated JSON mid-write returns lastValid without throwing
    fs.writeFileSync(statePath, '{"好感度": ', 'utf8');
    assert.deepEqual(safeReadJson(statePath, lastValid), lastValid);

    // Non-object JSON literal returns lastValid
    fs.writeFileSync(statePath, 'null', 'utf8');
    assert.deepEqual(safeReadJson(statePath, lastValid), lastValid);

    // Valid JSON (including UTF-8 BOM) updates cleanly
    fs.writeFileSync(statePath, '\ufeff{"好感度": 65, "天气": "雨"}', 'utf8');
    assert.deepEqual(safeReadJson(statePath, lastValid), { 好感度: 65, 天气: '雨' });
  });
});

test('hud.js CLI supports --once, --no-color, --help, campaign.json auto-title, and exits non-zero when missing in --once', () => {
  const helpRes = spawnSync(process.execPath, [HUD_SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(helpRes.status, 0);
  assert.match(helpRes.stdout, /--once/);
  assert.match(helpRes.stdout, /--no-color/);

  withTempDir((dir) => {
    const missingRes = spawnSync(process.execPath, [HUD_SCRIPT, path.join(dir, 'state.json'), '--once'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.notEqual(missingRes.status, 0);
    assert.match(`${missingRes.stdout}\n${missingRes.stderr}`, /state\.json/i);

    fs.writeFileSync(
      path.join(dir, 'campaign.json'),
      JSON.stringify({ char: '沈清秋', user: '林渊', hasStatus: true }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, 'state.json'),
      JSON.stringify({ 好感度: 70, 状态: ['专注'] }),
      'utf8'
    );

    // Default cwd ./state.json with --once --no-color
    const noColorOut = execFileSync(process.execPath, [HUD_SCRIPT, '--once', '--no-color'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.ok(!noColorOut.includes('\x1b['), 'expected no ANSI escapes with --no-color');
    assert.ok(noColorOut.includes('沈清秋 × 林渊'));
    assert.ok(noColorOut.includes('好感度'));
    assert.ok(noColorOut.includes('[专注]'));

    // With color (explicit path, --once without --no-color)
    const colorOut = execFileSync(process.execPath, [HUD_SCRIPT, path.join(dir, 'state.json'), '--once'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '' },
    });
    assert.ok(colorOut.includes('\x1b['), 'expected ANSI colors when --no-color is omitted');
    assert.ok(!colorOut.includes('\x1b[H\x1b[J'), '--once must not clear terminal screen');
  });
});

test('renderState does not collapse non-scalar { 状态/status, 详情/detail } objects to [object Object]', () => {
  const { renderState } = require('../skill/scripts/hud');

  const state = {
    user: {
      状态: {
        体力: 80,
        理智: 95,
      },
    },
    环境: {
      状态: ['暴雨', '夜'],
    },
    npc: {
      status: { hp: 50 },
      detail: 'injured',
    },
    npc2: {
      status: 'injured',
      detail: ['bleeding', 'dizzy'],
    },
    心情卡: {
      status: 'calm',
      detail: 'watching closely',
    },
  };

  const out = renderState(state, null, { color: false, width: 72 });
  assert.equal(out.includes('[object Object]'), false, `unexpected [object Object] in:\n${out}`);
  assert.ok(out.includes('▸ 状态'), `expected nested sub-section ▸ 状态 in:\n${out}`);
  assert.ok(out.includes('体力') && out.includes('80'), out);
  assert.ok(out.includes('理智') && out.includes('95'), out);
  assert.ok(out.includes('[暴雨]') && out.includes('[夜]'), `expected array chips for 环境.状态 in:\n${out}`);
  assert.ok(out.includes('▸ status'), `expected nested sub-section ▸ status in:\n${out}`);
  assert.ok(out.includes('hp:') && out.includes('50'), out);
  assert.ok(out.includes('detail: injured'), out);
  assert.ok(out.includes('[bleeding]') && out.includes('[dizzy]'), out);
  assert.ok(out.includes('↳ watching closely'), `scalar { status, detail } should still render card:\n${out}`);
});

test('renderState anchors rate/ratio/percent/pct gauge keys so crate/pirate/strategy do not render progress bars', () => {
  const { renderState } = require('../skill/scripts/hud');

  const state = {
    统计: {
      crate: 10,
      pirate: 20,
      strategy: 50,
      win_rate: 80,
      hp_pct: 50,
      ratio: 40,
      percent: 75,
    },
  };

  const out = renderState(state, null, { color: false, width: 72 });
  const lines = out.split(/\r?\n/);
  for (const nonGaugeKey of ['crate', 'pirate', 'strategy']) {
    const line = lines.find((l) => l.includes(`${nonGaugeKey}:`));
    assert.ok(line, `missing line for ${nonGaugeKey}`);
    assert.equal(/[█░]/.test(line), false, `${nonGaugeKey} must NOT render a progress bar: ${line}`);
  }
  for (const gaugeKey of ['win_rate', 'hp_pct', 'ratio', 'percent']) {
    const line = lines.find((l) => l.includes(`${gaugeKey}:`));
    assert.ok(line && /[█░]/.test(line), `${gaugeKey} should render a progress bar: ${line}`);
  }
});

test('hud.js watch mode waits cleanly when state.json is missing and renders as soon as valid state.json appears', async () => {
  await new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-bard-hud-watch-'));
    const statePath = path.join(dir, 'state.json');
    const child = spawn(process.execPath, [HUD_SCRIPT, statePath, '--no-color'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let phase = 'waiting';
    let settled = false;

    const cleanup = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill();
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore on Windows transient handle release
        }
        if (err) reject(err);
        else resolve();
      }, 80);
    };

    const timeout = setTimeout(() => {
      cleanup(new Error(`Watch test timed out in phase="${phase}". stdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (phase === 'waiting' && /waiting|等待/i.test(stdout)) {
        phase = 'writing-partial';
        // Simulate mid-write truncated JSON first, then valid JSON
        fs.writeFileSync(statePath, '{"好感度": ', 'utf8');
        setTimeout(() => {
          phase = 'writing-valid';
          fs.writeFileSync(statePath, JSON.stringify({ 好感度: 88, 心情: '安稳' }), 'utf8');
        }, 80);
      }
      if ((phase === 'writing-valid' || phase === 'writing-partial') && stdout.includes('好感度') && stdout.includes('88')) {
        assert.equal(stderr, '');
        cleanup(null);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => cleanup(err));
    child.on('exit', (code) => {
      if (!settled) {
        cleanup(new Error(`Watch child exited unexpectedly with code ${code}. stdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    });
  });
});
