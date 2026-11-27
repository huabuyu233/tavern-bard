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
