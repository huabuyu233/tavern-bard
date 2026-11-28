const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BIN_SCRIPT = path.join(REPO_ROOT, 'bin', 'tavern-bard.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-bard-bin-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('bin/tavern-bard.js supports --help and --version', () => {
  const helpRes = spawnSync(process.execPath, [BIN_SCRIPT, '--help'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(helpRes.status, 0, helpRes.stderr);
  assert.match(helpRes.stdout, /install/i);
  assert.match(helpRes.stdout, /uninstall/i);
  assert.match(helpRes.stdout, /status/i);
  assert.match(helpRes.stdout, /--dry-run/);

  const verRes = spawnSync(process.execPath, [BIN_SCRIPT, '--version'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(verRes.status, 0, verRes.stderr);
  assert.match(verRes.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('bin/tavern-bard.js install (default), status, and uninstall work in isolated HOME', () => {
  withTempDir((fakeHome) => {
    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };

    const dryRes = spawnSync(process.execPath, [BIN_SCRIPT, '--dry-run'], { cwd: REPO_ROOT, encoding: 'utf8', env });
    assert.equal(dryRes.status, 0, dryRes.stderr);
    assert.match(dryRes.stdout, /DRY-RUN/i);
    assert.equal(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'tavern-bard')), false);

    const installRes = spawnSync(process.execPath, [BIN_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8', env });
    assert.equal(installRes.status, 0, installRes.stderr);
    assert.equal(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'tavern-bard', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(fakeHome, '.claude', 'skills', 'tavern-bard', 'SKILL.md')), true);

    const statusRes = spawnSync(process.execPath, [BIN_SCRIPT, 'status'], { cwd: REPO_ROOT, encoding: 'utf8', env });
    assert.equal(statusRes.status, 0, statusRes.stderr);
    assert.match(statusRes.stdout, /installed/i);

    const unRes = spawnSync(process.execPath, [BIN_SCRIPT, 'uninstall'], { cwd: REPO_ROOT, encoding: 'utf8', env });
    assert.equal(unRes.status, 0, unRes.stderr);
    assert.equal(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'tavern-bard')), false);
    assert.equal(fs.existsSync(path.join(fakeHome, '.claude', 'skills', 'tavern-bard')), false);
  });
});

function createFakeCliShim(binDir, cliName, ext = process.platform === 'win32' ? '.cmd' : '') {
  fs.mkdirSync(binDir, { recursive: true });
  const filePath = path.join(binDir, `${cliName}${ext}`);
  const content = process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n';
  fs.writeFileSync(filePath, content, 'utf8');
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
  return filePath;
}

function createMinimalCampaign(dir, campaignOverrides = {}) {
  fs.mkdirSync(path.join(dir, 'card'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'worldbook'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'memory', 'full'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'memory', 'summary'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'card', 'character.md'), '# 铃兰\n温柔的旅店老板娘。\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'worldbook', 'always.md'), '常驻设定\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'worldbook', 'index.md'), '# Index\n', 'utf8');

  const campaign = {
    char: '铃兰',
    user: '旅人',
    currentTurn: 0,
    currentChapter: 1,
    hasPreset: false,
    hasStatus: false,
    ...campaignOverrides,
  };
  fs.writeFileSync(path.join(dir, 'campaign.json'), `${JSON.stringify(campaign, null, 2)}\n`, 'utf8');
  return campaign;
}

const DAY1_PROMPT = '请读取角色卡、常驻世界书与开场白，正式输出开场剧情（若存在多个开场白请供我选择）。';
const DAY2_PROMPT = '请按低Token恢复协议读取存档与近期记录，用两三句话沉浸式回顾上次停下的场景，等待我的下一步行动。';

function makeCleanEnv(overrides = {}) {
  const env = { ...process.env };
  const agentVars = [
    'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT',
    'CODEX_SANDBOX',
    'CODEX_CI',
    'CODEX_THREAD_ID',
    'CODEX_MANAGED_BY_NPM',
    'OPENCODE',
    'OPENCODE_CLIENT',
    'GEMINI_CLI',
    'ANTIGRAVITY_CLI_ALIAS',
    'ANTIGRAVITY_AGENT',
    'ANTIGRAVITY_VSCODE_HOST',
    'ANTIGRAVITY_LS_VERSION',
    'AGY_ENABLE_HUB',
    'CURSOR_TRACE_ID',
    'WINDSURF_SESSION',
  ];
  for (const key of agentVars) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

test('parseArgs and --help support play command and options', () => {
  const { parseArgs } = require('../bin/tavern-bard');

  const helpRes = spawnSync(process.execPath, [BIN_SCRIPT, '--help'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(helpRes.status, 0, helpRes.stderr);
  assert.match(helpRes.stdout, /\bplay\b/);
  assert.match(helpRes.stdout, /--cli\b/);
  assert.match(helpRes.stdout, /--dir\b/);

  const parsedSpace = parseArgs(['play', '--cli', 'codex', '--dir', '/tmp/my-camp', '--dry-run']);
  assert.equal(parsedSpace.command, 'play');
  assert.equal(parsedSpace.cli, 'codex');
  assert.equal(parsedSpace.dir, '/tmp/my-camp');
  assert.equal(parsedSpace.dryRun, true);

  const parsedEq = parseArgs(['play', '--cli=gemini', '--dir=/tmp/other']);
  assert.equal(parsedEq.command, 'play');
  assert.equal(parsedEq.cli, 'gemini');
  assert.equal(parsedEq.dir, '/tmp/other');
  assert.equal(parsedEq.dryRun, false);

  const parsedDefault = parseArgs(['play']);
  assert.equal(parsedDefault.command, 'play');
  assert.equal(parsedDefault.cli, null);
  assert.equal(parsedDefault.dir, process.cwd());

  assert.throws(() => parseArgs(['play', '--cli']), /--cli/);
  assert.throws(() => parseArgs(['play', '--cli', '--dry-run']), /--cli/);
  assert.throws(() => parseArgs(['play', '--cli=']), /--cli/);
  assert.throws(() => parseArgs(['play', '--dir']), /--dir/);
  assert.throws(() => parseArgs(['play', '--dir=']), /--dir/);
  assert.throws(() => parseArgs(['play', '--unknown-flag']), /Unknown/i);
  assert.throws(() => parseArgs(['status', '--cli', 'codex']), /play/i);
});

test('bin/tavern-bard.js play --dry-run inspects Day-1 and Day-2 campaigns across codex/claude/opencode/gemini/agy', () => {
  withTempDir((root) => {
    const binDir = path.join(root, 'fake-bin');
    createFakeCliShim(binDir, 'codex');
    createFakeCliShim(binDir, 'claude');
    createFakeCliShim(binDir, 'opencode');
    createFakeCliShim(binDir, 'gemini');
    createFakeCliShim(binDir, 'agy');

    const isolatedEnv = makeCleanEnv({
      PATH: binDir,
      Path: binDir,
    });

    const day1Dir = path.join(root, 'day1');
    createMinimalCampaign(day1Dir, { currentTurn: 0 });

    const codexRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--cli', 'codex', '--dir', day1Dir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(codexRes.status, 0, codexRes.stderr);
    assert.match(codexRes.stdout, /\[DRY-RUN\]/);
    assert.match(codexRes.stdout, /codex/i);
    assert.match(codexRes.stdout, /start|Day-1/i);
    const codexArgsMatch = codexRes.stdout.match(/^\s*Args:\s*(.+)$/m);
    assert.ok(codexArgsMatch, codexRes.stdout);
    assert.deepEqual(JSON.parse(codexArgsMatch[1]), [
      '-c',
      'model_instructions_file=".tavern-bard/system-prompt.md"',
      DAY1_PROMPT,
    ]);
    assert.equal(fs.existsSync(path.join(day1Dir, '.tavern-bard', 'system-prompt.md')), false);

    const claudeRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--cli=claude-code', `--dir=${day1Dir}`, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(claudeRes.status, 0, claudeRes.stderr);
    assert.ok(claudeRes.stdout.includes('--system-prompt-file'));
    assert.ok(claudeRes.stdout.includes('.tavern-bard/system-prompt.md'));
    assert.ok(claudeRes.stdout.includes(DAY1_PROMPT));

    const opencodeRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--cli', 'opencode', '--dir', day1Dir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(opencodeRes.status, 0, opencodeRes.stderr);
    assert.match(opencodeRes.stdout, /opencode/i);
    assert.ok(opencodeRes.stdout.includes('[]'));

    const geminiRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--cli', 'gemini', '--dir', day1Dir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(geminiRes.status, 0, geminiRes.stderr);
    assert.ok(geminiRes.stdout.includes('"-i"'));
    assert.ok(geminiRes.stdout.includes(DAY1_PROMPT));
    assert.ok(geminiRes.stdout.includes(path.join(day1Dir, '.tavern-bard', 'system-prompt.md')));

    const agyRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--cli', 'agy', '--dir', day1Dir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(agyRes.status, 0, agyRes.stderr);
    const agyArgsMatch = agyRes.stdout.match(/^\s*Args:\s*(.+)$/m);
    assert.ok(agyArgsMatch, agyRes.stdout);
    assert.deepEqual(JSON.parse(agyArgsMatch[1]), ['--agent', 'tavern-bard', '-i', DAY1_PROMPT]);

    const antigravityAliasRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--cli=antigravity', '--dir', day1Dir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(antigravityAliasRes.status, 0, antigravityAliasRes.stderr);
    assert.match(antigravityAliasRes.stdout, /CLI:\s*agy\b/);

    // Host env priority: ANTIGRAVITY_AGENT=1 picks agy instead of codex when preferredCli is unset
    const agyHostEnv = makeCleanEnv({
      PATH: binDir,
      Path: binDir,
      ANTIGRAVITY_AGENT: '1',
    });
    const hostPickRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', day1Dir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: agyHostEnv }
    );
    assert.equal(hostPickRes.status, 0, hostPickRes.stderr);
    assert.match(hostPickRes.stdout, /CLI:\s*agy\b/);

    // Day-2 via currentTurn > 0
    const day2TurnDir = path.join(root, 'day2-turn');
    createMinimalCampaign(day2TurnDir, { currentTurn: 3, preferredCli: 'claude' });
    const day2Res = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', day2TurnDir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(day2Res.status, 0, day2Res.stderr);
    assert.match(day2Res.stdout, /claude/i);
    assert.match(day2Res.stdout, /resume|Day-2/i);
    assert.ok(day2Res.stdout.includes(DAY2_PROMPT));

    // Day-2 via ## Opening in chapter-01.md even when currentTurn is 0
    const day2OpeningDir = path.join(root, 'day2-opening');
    createMinimalCampaign(day2OpeningDir, { currentTurn: 0 });
    fs.writeFileSync(
      path.join(day2OpeningDir, 'memory', 'full', 'chapter-01.md'),
      '# Chapter 01\n\n## Opening\n雨夜酒馆的灯火。\n',
      'utf8'
    );
    const openingRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', day2OpeningDir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedEnv }
    );
    assert.equal(openingRes.status, 0, openingRes.stderr);
    assert.match(openingRes.stdout, /codex/i); // first installedCli fallback
    assert.ok(openingRes.stdout.includes(DAY2_PROMPT));
  });
});

test('bin/tavern-bard.js play fails cleanly on missing campaign.json, invalid/missing --cli, or missing CLI in PATH', () => {
  withTempDir((root) => {
    const emptyDir = path.join(root, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const binDir = path.join(root, 'fake-bin');
    createFakeCliShim(binDir, 'codex');

    const envWithCodex = makeCleanEnv({ PATH: binDir, Path: binDir });
    const envEmptyPath = makeCleanEnv({ PATH: emptyDir, Path: emptyDir });

    const noCampaignRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', emptyDir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: envWithCodex }
    );
    assert.notEqual(noCampaignRes.status, 0);
    assert.match(noCampaignRes.stderr, /campaign\.json not found/i);

    const campDir = path.join(root, 'camp');
    createMinimalCampaign(campDir);

    const badCliRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', campDir, '--cli', 'vim', '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: envWithCodex }
    );
    assert.notEqual(badCliRes.status, 0);
    assert.match(badCliRes.stderr, /codex, claude, opencode, gemini, agy/);
    assert.match(badCliRes.stderr, /--launch-arg/);

    const missingValRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', campDir, '--cli'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: envWithCodex }
    );
    assert.notEqual(missingValRes.status, 0);
    assert.match(missingValRes.stderr, /--cli/);

    const missingInPathRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', campDir, '--cli', 'gemini', '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: envWithCodex }
    );
    assert.notEqual(missingInPathRes.status, 0);
    assert.match(missingInPathRes.stderr, /not found in PATH/i);

    const noCliAtAllRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', campDir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: envEmptyPath }
    );
    assert.notEqual(noCliAtAllRes.status, 0);
    assert.match(noCliAtAllRes.stderr, /No supported pure-mode CLI/i);
  });
});

test('runPlayCommand sets up pure environment, updates campaign.json, and spawns CLIs cross-platform', () => {
  const { runPlayCommand } = require('../bin/tavern-bard');

  withTempDir((root) => {
    const campDir = path.join(root, 'camp');
    createMinimalCampaign(campDir, { currentTurn: 0 });

    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    };

    // 1. Windows .cmd wrapping via powershell.exe for codex
    const codexRes = runPlayCommand({
      dir: campDir,
      cli: 'codex',
      dryRun: false,
      platform: 'win32',
      env: { PATH: 'C:\\fake', SystemRoot: 'C:\\Windows' },
      commandExists: (name) => name === 'codex',
      resolveExecutable: () => ({ path: "C:\\Program Files\\npm\\O'Reilly\\codex.cmd", kind: 'cmd' }),
      spawnImpl: fakeSpawn,
    });

    assert.equal(codexRes.exitCode, 0);
    assert.equal(codexRes.dryRun, false);
    assert.equal(codexRes.cli, 'codex');
    assert.equal(codexRes.isResume, false);
    assert.equal(fs.existsSync(path.join(campDir, '.tavern-bard', 'system-prompt.md')), true);
    // Must NOT fabricate configs for uninstalled/unrequested CLIs
    assert.equal(fs.existsSync(path.join(campDir, '.claude', 'agents', 'tavern-bard.md')), false);
    assert.equal(fs.existsSync(path.join(campDir, '.gemini', '.env')), false);
    assert.equal(fs.existsSync(path.join(campDir, 'opencode.json')), false);
    assert.equal(fs.existsSync(path.join(campDir, '.opencode', 'agents', 'tavern-bard.md')), false);

    const savedCamp1 = JSON.parse(fs.readFileSync(path.join(campDir, 'campaign.json'), 'utf8'));
    assert.equal(savedCamp1.pureEnvPrepared, true);
    assert.equal(savedCamp1.preferredCli, 'codex');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'powershell.exe');
    assert.equal(calls[0].args[0], '-NoProfile');
    assert.equal(calls[0].args[1], '-Command');
    assert.ok(calls[0].args[2].includes("& 'C:\\Program Files\\npm\\O''Reilly\\codex.cmd'"));
    assert.ok(calls[0].args[2].includes('\'-c\' \'model_instructions_file=".tavern-bard/system-prompt.md"\''));
    assert.ok(calls[0].args[2].includes(`'${DAY1_PROMPT}'`));
    assert.equal(calls[0].opts.cwd, path.resolve(campDir));
    assert.equal(calls[0].opts.stdio, 'inherit');
    assert.equal(calls[0].opts.shell, false);

    // 2. Windows .ps1 wrapping for claude + Day-2 transition + config creation
    savedCamp1.currentTurn = 2;
    fs.writeFileSync(path.join(campDir, 'campaign.json'), `${JSON.stringify(savedCamp1, null, 2)}\n`, 'utf8');

    const claudeRes = runPlayCommand({
      dir: campDir,
      cli: 'claude',
      dryRun: false,
      platform: 'win32',
      env: { PATH: 'C:\\fake' },
      commandExists: (name) => name === 'claude',
      resolveExecutable: () => ({ path: 'C:\\bin\\claude.ps1', kind: 'ps1' }),
      spawnImpl: fakeSpawn,
    });

    assert.equal(claudeRes.cli, 'claude');
    assert.equal(claudeRes.isResume, true);
    assert.equal(fs.existsSync(path.join(campDir, '.claude', 'agents', 'tavern-bard.md')), true);
    const savedCamp2 = JSON.parse(fs.readFileSync(path.join(campDir, 'campaign.json'), 'utf8'));
    assert.equal(savedCamp2.preferredCli, 'claude');

    assert.equal(calls.length, 2);
    assert.equal(calls[1].cmd, 'powershell.exe');
    assert.deepEqual(calls[1].args, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\bin\\claude.ps1',
      '--system-prompt-file',
      '.tavern-bard/system-prompt.md',
      DAY2_PROMPT,
    ]);

    // 3. POSIX binary direct spawn for gemini + GEMINI_SYSTEM_MD env + exit code propagation
    const geminiRes = runPlayCommand({
      dir: campDir,
      cli: 'gemini',
      dryRun: false,
      platform: 'linux',
      env: { PATH: '/usr/local/bin', FOO: 'bar' },
      commandExists: (name) => name === 'gemini',
      resolveExecutable: () => ({ path: '/usr/local/bin/gemini', kind: 'bin' }),
      spawnImpl: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 42 };
      },
    });

    assert.equal(geminiRes.exitCode, 42);
    assert.equal(geminiRes.cli, 'gemini');
    assert.equal(fs.existsSync(path.join(campDir, '.gemini', '.env')), true);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].cmd, '/usr/local/bin/gemini');
    assert.deepEqual(calls[2].args, ['-i', DAY2_PROMPT]);
    assert.equal(calls[2].opts.env.FOO, 'bar');
    assert.equal(
      calls[2].opts.env.GEMINI_SYSTEM_MD,
      path.join(path.resolve(campDir), '.tavern-bard', 'system-prompt.md')
    );

    // 4. OpenCode launch prints 1-line tip and spawns with empty args
    const opencodeRes = runPlayCommand({
      dir: campDir,
      cli: 'opencode',
      dryRun: false,
      platform: 'linux',
      env: { PATH: '/usr/local/bin' },
      commandExists: (name) => name === 'opencode',
      resolveExecutable: () => ({ path: '/usr/local/bin/opencode', kind: 'bin' }),
      spawnImpl: fakeSpawn,
    });

    assert.equal(opencodeRes.exitCode, 0);
    assert.deepEqual(opencodeRes.args, []);
    assert.equal(fs.existsSync(path.join(campDir, '.opencode', 'agents', 'tavern-bard.md')), true);
    assert.equal(fs.existsSync(path.join(campDir, 'opencode.json')), true);
    assert.equal(calls.length, 4);
    assert.equal(calls[3].cmd, '/usr/local/bin/opencode');
    assert.deepEqual(calls[3].args, []);

    // 5. Switching CLI when needsPureEnvSetup is false still syncs AGENTS.md with new preferredCli & Pure tip
    fs.writeFileSync(
      path.join(campDir, 'AGENTS.md'),
      '# Tavern-Bard Roleplay Campaign: 江亦雪 × 陈默\n\n- `C:\\fake\\SKILL.md`\n',
      'utf8'
    );
    const staleCamp = JSON.parse(fs.readFileSync(path.join(campDir, 'campaign.json'), 'utf8'));
    staleCamp.preferredCli = 'opencode';
    staleCamp.pureEnvPrepared = false;
    fs.writeFileSync(path.join(campDir, 'campaign.json'), `${JSON.stringify(staleCamp, null, 2)}\n`, 'utf8');

    const switchRes = runPlayCommand({
      dir: campDir,
      cli: 'claude',
      dryRun: false,
      platform: 'linux',
      env: { PATH: '/usr/local/bin' },
      commandExists: (name) => name === 'claude',
      resolveExecutable: () => ({ path: '/usr/local/bin/claude', kind: 'bin' }),
      spawnImpl: fakeSpawn,
    });
    assert.equal(switchRes.cli, 'claude');
    const syncedAgents = fs.readFileSync(path.join(campDir, 'AGENTS.md'), 'utf8');
    assert.match(syncedAgents, /## Pure Environment Resume Tip/);
    assert.match(syncedAgents, /preferred CLI: `claude`/);

    // 6. agy launch creates .agents/agents/tavern-bard/agent.md and spawns agy.exe
    const agyRes = runPlayCommand({
      dir: campDir,
      cli: 'agy',
      dryRun: false,
      platform: 'win32',
      env: { PATH: 'C:\\agy\\bin' },
      commandExists: (name) => name === 'agy',
      resolveExecutable: () => ({ path: 'C:\\agy\\bin\\agy.exe', kind: 'exe' }),
      spawnImpl: fakeSpawn,
    });
    assert.equal(agyRes.cli, 'agy');
    assert.equal(
      fs.existsSync(path.join(campDir, '.agents', 'agents', 'tavern-bard', 'agent.md')),
      true
    );
    assert.equal(calls[5].cmd, 'C:\\agy\\bin\\agy.exe');
    assert.deepEqual(calls[5].args, ['--agent', 'tavern-bard', '-i', DAY2_PROMPT]);

    // 7. Custom pureLauncher in campaign.json works in --dry-run and runPlayCommand
    const customDir = path.join(root, 'custom-camp');
    createMinimalCampaign(customDir, {
      currentTurn: 1,
      preferredCli: 'my-cli',
      pureEnvPrepared: true,
      pureLauncher: {
        cli: 'my-cli',
        args: ['--sys', '{systemPrompt}', '--msg', '{prompt}'],
        env: { CUSTOM_PROMPT_FILE: '{systemPromptAbs}' },
      },
    });
    fs.mkdirSync(path.join(customDir, '.tavern-bard'), { recursive: true });
    fs.writeFileSync(path.join(customDir, '.tavern-bard', 'system-prompt.md'), '# Pure\n', 'utf8');

    const customBin = path.join(root, 'custom-bin');
    createFakeCliShim(customBin, 'my-cli');
    const dryCustomRes = spawnSync(
      process.execPath,
      [BIN_SCRIPT, 'play', '--dir', customDir, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: makeCleanEnv({ PATH: customBin, Path: customBin }) }
    );
    assert.equal(dryCustomRes.status, 0, dryCustomRes.stderr);
    assert.match(dryCustomRes.stdout, /CLI:\s*my-cli\b/);
    assert.ok(dryCustomRes.stdout.includes('.tavern-bard/system-prompt.md'));
    assert.ok(dryCustomRes.stdout.includes('Env CUSTOM_PROMPT_FILE:'));

    const customSpawnRes = runPlayCommand({
      dir: customDir,
      dryRun: false,
      platform: 'linux',
      env: { PATH: '/custom/bin' },
      commandExists: (name) => name === 'my-cli',
      resolveExecutable: () => ({ path: '/custom/bin/my-cli', kind: 'bin' }),
      spawnImpl: fakeSpawn,
    });
    assert.equal(customSpawnRes.cli, 'my-cli');
    assert.equal(calls[6].cmd, '/custom/bin/my-cli');
    assert.deepEqual(calls[6].args, [
      '--sys',
      '.tavern-bard/system-prompt.md',
      '--msg',
      DAY2_PROMPT,
    ]);
    assert.equal(
      calls[6].opts.env.CUSTOM_PROMPT_FILE,
      path.join(path.resolve(customDir), '.tavern-bard', 'system-prompt.md')
    );
  });
});
