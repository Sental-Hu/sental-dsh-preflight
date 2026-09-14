import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJson, stopTree } from './engine.mjs';

test('service aggregates failures, reuses unchanged results and rescans one changed plugin', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-service-'));
  const source = path.dirname(fileURLToPath(import.meta.url));
  const launcher = path.join(root, 'launcher with spaces');
  const repo = path.join(root, 'host');
  const home = path.join(root, 'home');
  const profile = path.join(home, 'profiles/web');
  let child, closed, endpoint, errors = '';
  try {
    fs.mkdirSync(launcher);
    for (const file of ['server.mjs','config.mjs','engine.mjs','cache.mjs','security.mjs','launcher.html','Probe-Process.ps1']) {
      fs.copyFileSync(path.join(source, file), path.join(launcher, file));
    }
    fs.symlinkSync(path.join(source, 'node_modules'), path.join(launcher, 'node_modules'), 'junction');
    writeJson(path.join(repo, 'package.json'), { name: 'fixture-host', version: '1' });
    fs.mkdirSync(path.join(repo, 'apps/cli/lib'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'apps/cli/lib/bin.js'), `
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const profile = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'profiles/web/package.json')));
if (profile.dsh.profile.bundles.includes('plugin-broken')) {
  console.error('Error: dsh: plugin tree failed to load: cannot get property "exampleService" without inject');
  process.exit(1);
}
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/client.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/client.js' ? 'window.fixture = true;' : '<script>window.__DSH_BOOT__={"entries":[{"url":"/client.js"}]};</script>');
});
server.listen(0, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:' + server.address().port + '/?token=fixture'));
`);
    writeJson(path.join(profile, 'package.json'), { dependencies: { 'plugin-good': '1', 'plugin-broken': '1' }, dsh: { profile: { bundles: ['plugin-good', 'plugin-broken'] } } });
    for (const name of ['plugin-good', 'plugin-broken']) {
      writeJson(path.join(profile, 'node_modules', name, 'package.json'), { name, version: '1', dsh: { bundle: { patch: 'cordis.patch.yml' } } });
    }
    const original = fs.readFileSync(path.join(profile, 'package.json'), 'utf8');
    writeJson(path.join(launcher, 'launcher-config.json'), { repository: repo, home });
    const env = { ...process.env }; delete env.DSH_HOME; delete env.DSH_LAUNCHER_REPO;
    child = spawn(process.execPath, [path.join(launcher, 'server.mjs')], { env, cwd: launcher, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', b => { errors += b; });
    closed = new Promise(resolve => child.once('close', resolve));
    const deadline = Date.now() + 70000;
    async function waitFor(fn) {
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(errors || 'Selector exited');
        const value = await fn(); if (value) return value;
        await delay(150);
      }
      throw new Error('Service test timed out: ' + errors);
    }
    await waitFor(() => {
      try { endpoint = readJson(path.join(launcher, 'launcher-endpoint.json')).url; return endpoint; } catch { return false; }
    });
    const request = async (route, body) => {
      const url = new URL(endpoint); url.pathname = route;
      const response = await fetch(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); return response.json();
    };
    const ready = () => waitFor(async () => { const s = await request('/state'); if (s.phase === 'error') throw Error(s.error); return s.phase === 'ready' && s; });
    let state = await ready();
    assert.equal(state.base.status, 'passed');
    assert.deepEqual(state.items.map(i => i.status), ['passed', 'failed']);
    assert.match(state.items[1].reason, /exampleService/);
    const logs = () => fs.readdirSync(path.join(launcher, 'check-logs')).length;
    assert.equal(logs(), 3);
    const unauthorized = await fetch(new URL('/state', endpoint)); assert.equal(unauthorized.status, 403);
    await request('/scan', {}); state = await ready();
    assert.ok(state.base.cached && state.items.every(i => i.cached)); assert.equal(logs(), 3);
    fs.writeFileSync(path.join(profile, 'node_modules/plugin-good/index.js'), 'changed');
    await request('/scan', {}); state = await ready();
    assert.equal(state.items[0].cached, false); assert.equal(state.items[1].cached, true); assert.equal(logs(), 4);
    assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), original);
    await request('/close', {}); await closed;
    assert.equal(fs.existsSync(path.join(launcher, 'launcher-endpoint.json')), false);
  } finally {
    if (child && child.exitCode === null) { await stopTree(child); await closed; }
    const link = path.join(launcher, 'node_modules');
    if (fs.existsSync(link)) fs.unlinkSync(link);
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
