const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEPLOY_SCRIPT = path.join(REPO_ROOT, 'scripts', 'deploy.js');

const { deploySkill } = require('../scripts/deploy');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-bard-deploy-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createMockRepo(rootDir) {
  const repoSkillDir = path.join(rootDir, 'repo', 'skill');
  writeFile(path.join(repoSkillDir, 'SKILL.md'), '# Tavern Bard\n');
  writeFile(path.join(repoSkillDir, 'scripts', 'init.js'), 'console.log("init");\n');
  writeFile(path.join(repoSkillDir, 'scripts', 'lib', 'card-loader.js'), 'module.exports = {};\n');
  writeFile(path.join(repoSkillDir, 'references', 'memory-guide.md'), '# Memory Guide\n');

  // Sibling directories that must never be copied to agentsSkillDir
  writeFile(path.join(rootDir, 'repo', 'docs', 'plan.md'), '# Secret Plan\n');
  writeFile(path.join(rootDir, 'repo', 'tests', 'foo.test.js'), '// test\n');
  writeFile(path.join(rootDir, 'repo', '示例资源', 'card.png'), 'png-bytes');

  return repoSkillDir;
}

test('deploySkill copies only repoSkillDir files into agentsSkillDir and excludes sibling repo dirs', () => {
  withTempDir((dir) => {
    const repoSkillDir = createMockRepo(dir);
    const agentsSkillDir = path.join(dir, 'home', '.agents', 'skills', 'tavern-bard');

    const result = deploySkill({
      repoSkillDir,
      agentsSkillDir,
      linkTargets: [],
      legacyPaths: [],
    });

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.copiedFiles, [
      'SKILL.md',
      'references/memory-guide.md',
      'scripts/init.js',
      'scripts/lib/card-loader.js',
    ]);
    assert.deepEqual(result.linked, []);
    assert.deepEqual(result.removedLegacy, []);

    assert.equal(fs.readFileSync(path.join(agentsSkillDir, 'SKILL.md'), 'utf8'), '# Tavern Bard\n');
    assert.equal(
      fs.readFileSync(path.join(agentsSkillDir, 'scripts', 'lib', 'card-loader.js'), 'utf8'),
      'module.exports = {};\n'
    );
    assert.equal(fs.existsSync(path.join(agentsSkillDir, 'docs')), false);
    assert.equal(fs.existsSync(path.join(agentsSkillDir, 'tests')), false);
    assert.equal(fs.existsSync(path.join(agentsSkillDir, '示例资源')), false);
  });
});

test('deploySkill removes legacy dirs, files, and broken links before creating fresh links at linkTargets', () => {
  withTempDir((dir) => {
    const repoSkillDir = createMockRepo(dir);
    const home = path.join(dir, 'home');
    const agentsSkillDir = path.join(home, '.agents', 'skills', 'tavern-bard');

    const claudeLink = path.join(home, '.claude', 'skills', 'tavern-bard');
    const geminiLink = path.join(home, '.gemini', 'config', 'skills', 'tavern-bard');
    const brokenLink = path.join(home, '.broken', 'skills', 'tavern-bard');
    const mirrorLegacy = path.join(home, 'ai_agents_config', '.gemini', 'config', 'skills', 'tavern-bard');
    const legacyFile = path.join(home, 'legacy-file-entry');
    const missingLegacy = path.join(home, 'does-not-exist');

    // Legacy real directory at geminiLink (same path as linkTarget)
    writeFile(path.join(geminiLink, 'turn_helper.js'), '// legacy\n');
    writeFile(path.join(geminiLink, 'nested', 'old.txt'), 'old\n');

    // Legacy mirror directory & legacy plain file
    writeFile(path.join(mirrorLegacy, 'SKILL.md'), '# Legacy\n');
    writeFile(legacyFile, 'stale file');

    // Broken symlink/junction at brokenLink
    const goneTarget = path.join(dir, 'gone-target');
    fs.mkdirSync(goneTarget, { recursive: true });
    fs.mkdirSync(path.dirname(brokenLink), { recursive: true });
    fs.symlinkSync(
      path.resolve(goneTarget),
      brokenLink,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    fs.rmSync(goneTarget, { recursive: true, force: true });

    const result = deploySkill({
      repoSkillDir,
      agentsSkillDir,
      linkTargets: [claudeLink, geminiLink, brokenLink],
      legacyPaths: [geminiLink, mirrorLegacy, legacyFile, missingLegacy],
    });

    assert.deepEqual(
      result.removedLegacy.map((p) => path.resolve(p)).sort(),
      [geminiLink, mirrorLegacy, legacyFile].map((p) => path.resolve(p)).sort()
    );
    assert.deepEqual(
      result.linked.map((p) => path.resolve(p)),
      [claudeLink, geminiLink, brokenLink].map((p) => path.resolve(p))
    );

    assert.equal(fs.existsSync(mirrorLegacy), false);
    assert.equal(fs.existsSync(legacyFile), false);

    const expectedRealTarget = fs.realpathSync(agentsSkillDir);
    for (const linkPath of [claudeLink, geminiLink, brokenLink]) {
      const stat = fs.lstatSync(linkPath);
      assert.equal(stat.isSymbolicLink(), true, `expected symlink/junction at ${linkPath}`);
      assert.equal(fs.realpathSync(linkPath), expectedRealTarget);
      assert.equal(fs.readFileSync(path.join(linkPath, 'SKILL.md'), 'utf8'), '# Tavern Bard\n');
      assert.equal(fs.existsSync(path.join(linkPath, 'turn_helper.js')), false);
    }
  });
});

test('deploySkill is idempotent on re-run and strips stale files without destroying target via old links', () => {
  withTempDir((dir) => {
    const repoSkillDir = createMockRepo(dir);
    const home = path.join(dir, 'home');
    const agentsSkillDir = path.join(home, '.agents', 'skills', 'tavern-bard');
    const claudeLink = path.join(home, '.claude', 'skills', 'tavern-bard');
    const geminiLink = path.join(home, '.gemini', 'config', 'skills', 'tavern-bard');

    const opts = {
      repoSkillDir,
      agentsSkillDir,
      linkTargets: [claudeLink, geminiLink],
      legacyPaths: [geminiLink],
    };

    deploySkill(opts);

    // Simulate stale files in agentsSkillDir and update/delete files in repoSkillDir
    writeFile(path.join(agentsSkillDir, 'stale.txt'), 'old version artifact\n');
    writeFile(path.join(agentsSkillDir, 'scripts', 'deprecated.js'), '// stale\n');
    writeFile(path.join(repoSkillDir, 'SKILL.md'), '# Tavern Bard v2\n');
    fs.rmSync(path.join(repoSkillDir, 'references', 'memory-guide.md'));

    const second = deploySkill(opts);

    assert.deepEqual(second.copiedFiles, [
      'SKILL.md',
      'scripts/init.js',
      'scripts/lib/card-loader.js',
    ]);
    assert.equal(fs.existsSync(path.join(agentsSkillDir, 'stale.txt')), false);
    assert.equal(fs.existsSync(path.join(agentsSkillDir, 'scripts', 'deprecated.js')), false);
    assert.equal(fs.existsSync(path.join(agentsSkillDir, 'references', 'memory-guide.md')), false);
    assert.equal(fs.readFileSync(path.join(agentsSkillDir, 'SKILL.md'), 'utf8'), '# Tavern Bard v2\n');

    const expectedRealTarget = fs.realpathSync(agentsSkillDir);
    for (const linkPath of [claudeLink, geminiLink]) {
      assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
      assert.equal(fs.realpathSync(linkPath), expectedRealTarget);
      assert.equal(fs.readFileSync(path.join(linkPath, 'SKILL.md'), 'utf8'), '# Tavern Bard v2\n');
    }
  });
});

test('deploySkill validates repoSkillDir existence and SKILL.md presence', () => {
  withTempDir((dir) => {
    const missingRepo = path.join(dir, 'missing-skill');
    const emptySkillDir = path.join(dir, 'empty-skill');
    fs.mkdirSync(emptySkillDir, { recursive: true });
    const agentsSkillDir = path.join(dir, 'agents', 'tavern-bard');

    assert.throws(
      () => deploySkill({ repoSkillDir: missingRepo, agentsSkillDir }),
      /repoSkillDir|not exist|SKILL\.md/i
    );
    assert.throws(
      () => deploySkill({ repoSkillDir: emptySkillDir, agentsSkillDir }),
      /SKILL\.md/i
    );
  });
});

test('deploySkill with dryRun: true performs zero filesystem mutations while reporting plan', () => {
  withTempDir((dir) => {
    const repoSkillDir = createMockRepo(dir);
    const home = path.join(dir, 'home');
    const agentsSkillDir = path.join(home, '.agents', 'skills', 'tavern-bard');
    const claudeLink = path.join(home, '.claude', 'skills', 'tavern-bard');
    const geminiLink = path.join(home, '.gemini', 'config', 'skills', 'tavern-bard');

    writeFile(path.join(agentsSkillDir, 'preexisting.txt'), 'keep me\n');
    writeFile(path.join(geminiLink, 'turn_helper.js'), '// keep me\n');

    const result = deploySkill({
      repoSkillDir,
      agentsSkillDir,
      linkTargets: [claudeLink, geminiLink],
      legacyPaths: [geminiLink],
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.deepEqual(result.copiedFiles, [
      'SKILL.md',
      'references/memory-guide.md',
      'scripts/init.js',
      'scripts/lib/card-loader.js',
    ]);
    assert.deepEqual(result.removedLegacy, [path.resolve(geminiLink)]);
    assert.deepEqual(result.linked, [path.resolve(claudeLink), path.resolve(geminiLink)]);

    // Zero filesystem mutations
    assert.equal(fs.readFileSync(path.join(agentsSkillDir, 'preexisting.txt'), 'utf8'), 'keep me\n');
    assert.equal(fs.existsSync(path.join(agentsSkillDir, 'SKILL.md')), false);
    assert.equal(fs.readFileSync(path.join(geminiLink, 'turn_helper.js'), 'utf8'), '// keep me\n');
    assert.equal(fs.lstatSync(geminiLink).isSymbolicLink(), false);
    assert.equal(fs.existsSync(claudeLink), false);
  });
});

test('deploy.js CLI supports --help, --dry-run (with isolated HOME/USERPROFILE), and rejects unknown flags', () => {
  const helpRes = spawnSync(process.execPath, [DEPLOY_SCRIPT, '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(helpRes.status, 0, helpRes.stderr);
  assert.match(helpRes.stdout, /--dry-run/);

  const badRes = spawnSync(process.execPath, [DEPLOY_SCRIPT, '--bogus-flag'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(badRes.status, 0);
  assert.match(badRes.stderr, /Unknown option/i);

  withTempDir((fakeHome) => {
    const legacyFile = path.join(fakeHome, '.gemini', 'config', 'skills', 'tavern-bard', 'turn_helper.js');
    writeFile(legacyFile, '// legacy\n');

    const dryRes = spawnSync(process.execPath, [DEPLOY_SCRIPT, '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
      },
    });
    assert.equal(dryRes.status, 0, dryRes.stderr);
    assert.match(dryRes.stdout, /dry-run/i);
    assert.match(dryRes.stdout, /SKILL\.md/);
    assert.equal(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'tavern-bard')), false);
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), '// legacy\n');
  });
});
