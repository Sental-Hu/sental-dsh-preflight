import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.mjs';
import { writeJson } from './engine.mjs';

test('configuration works outside the DSH tree, supports Unicode paths and explicit overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-'));
  try {
    const repo = path.join(root, '源码 with spaces');
    const home = path.join(root, '数据 home');
    const launcher = path.join(root, 'separate-launcher');
    fs.mkdirSync(path.join(repo, 'apps/cli/lib'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'apps/cli/lib/bin.js'), '');
    writeJson(path.join(home, 'profiles/web/package.json'), {});
    assert.throws(() => loadConfig(launcher, {}), /absolute DSH repository/);
    writeJson(path.join(launcher, 'launcher-config.json'), { repository: repo, home });
    assert.deepEqual(loadConfig(launcher, {}), { repo, home });
    assert.throws(() => loadConfig(launcher, { DSH_LAUNCHER_REPO: 'relative' }), /absolute/);
    assert.throws(() => loadConfig(launcher, { DSH_HOME: 'relative' }), /absolute/);
    const alternative = path.join(root, 'other-home');
    writeJson(path.join(alternative, 'profiles/web/package.json'), {});
    assert.equal(loadConfig(launcher, { DSH_HOME: alternative }).home, alternative);
    fs.unlinkSync(path.join(repo, 'apps/cli/lib/bin.js'));
    assert.throws(() => loadConfig(launcher, {}), /build is missing/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
