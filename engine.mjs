import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fingerprintInventory } from './cache.mjs';

export const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
export function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function paths(launcher, repo, home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {
  return { launcher, repo, home, profile: path.join(home, 'profiles/web'), entry: path.join(repo, 'apps/cli/lib/bin.js') };
}
const yamlCache = new Map();
export function yamlFor(repo) {
  if (yamlCache.has(repo)) return yamlCache.get(repo);
  class Expression { constructor(text) { this.text = text; } }
  const type = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: text => new Expression(text), instanceOf: Expression, represent: v => v.text });
  const schema = yaml.DEFAULT_SCHEMA.extend([type]);
  const adapter = { load: text => yaml.load(text, { schema }), dump: v => yaml.dump(v, { schema, lineWidth: -1 }) };
  yamlCache.set(repo, adapter);
  return adapter;
}
export function discover(p) {
  const manifestPath = path.join(p.profile, 'package.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const bundles = manifest.dsh.profile.bundles;
  const yaml = yamlFor(p.repo);
  const candidates = new Set([...Object.keys(manifest.dependencies || {}), ...bundles]);
  const items = [];
  for (const name of candidates) {
    if (name.startsWith('@deepseek-ai/')) continue;
    const dir = path.join(p.profile, 'node_modules', name);
    let meta;
    try { meta = readJson(path.join(dir, 'package.json')); } catch {
      if (bundles.includes(name)) items.push({ id: name, name, kind: 'bundle', version: '?', enabled: true, missing: true });
      continue;
    }
    if (!meta.dsh?.bundle?.patch && !bundles.includes(name)) continue;
    items.push({ id: name, name, kind: 'bundle', dir, version: meta.version, description: meta.description || '', enabled: bundles.includes(name) });
  }
  const patches = [], commonPatches = [];
  for (const [scope, file] of [['profile', path.join(p.profile, 'cordis.patch.yml')], ['home', path.join(p.home, 'cordis.patch.yml')]]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const rows = yaml.load(text) || [];
    patches.push({ file, text });
    commonPatches.push(rows.filter(row => !row.insert));
    for (const patch of rows) for (const row of patch.insert || []) {
      if (!row.id || !row.name) continue;
      items.push({ id: `patch:${scope}:${row.id}`, rowId: row.id, name: row.name, version: '手动配置', kind: 'patch', row, enabled: row.disabled !== true, description: row.config?.serverName ? `${row.config.serverName} 工具服务` : '配置文件中的扩展' });
    }
  }
  let saved = {};
  try { saved = readJson(path.join(p.launcher, 'selection.json')); } catch {}
  for (const item of items) item.selected = typeof saved.selected?.[item.id] === 'boolean' ? saved.selected[item.id] : item.enabled;
  const core = bundles.filter(b => !items.some(i => i.kind === 'bundle' && i.id === b));
  const inventory = { items, core, manifest, raw, patches };
  Object.assign(inventory, fingerprintInventory(p, inventory, commonPatches));
  inventory.signature = hash(raw + patches.map(i => i.text).join('') + inventory.baseKey + items.map(i=>i.checkKey).join(''));
  return inventory;
}

export function errorSummary(text) {
  const lines = text.split(/\r?\n/);
  const message = lines.find(s => /^Error: dsh:/.test(s)) || lines.find(s => /^(SyntaxError|Error):/.test(s)) || lines.slice(-5).join(' ');
  const summary = (message || '进程提前退出，详情见检查日志').replace(/^Error: dsh: plugin tree failed to load: /, '').slice(0, 1600);
  const inject = summary.match(/cannot get property "([^"]+)" without inject/);
  if (inject) return `接口不兼容：插件未声明所需的 ${inject[1]} 服务。`;
  const missing = summary.match(/does not provide an export named '([^']+)'/);
  if (missing) return `接口不兼容：当前 DSH 缺少插件需要的 ${missing[1]} 接口。`;
  return summary;
}
export function manifestScripts(html) {
  const match = html.match(/(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\])\s*=\s*(\{.*?\})\s*;?\s*<\/script>/s);
  if (!match) throw new Error('启动清单缺失');
  const boot = JSON.parse(match[1]);
  const urls = [...(boot.entries || []), ...(boot.batches || [])].map(x => x.url).filter(Boolean);
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) urls.push(m[1].replaceAll('&amp;', '&'));
  if (!urls.length) throw new Error('启动脚本为空');
  return [...new Set(urls)].map(u => {
    u = u.replace(/^\.\//, '/');
    if (!u.startsWith('/') || u.startsWith('//')) throw new Error('启动脚本地址无效');
    return u;
  });
}
export async function health(url, signal) {
  const origin = new URL(url).origin;
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) });
  const cookies = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  // Token entry may redirect to the clean URL; carry the issued session cookie.
  const page = response.status >= 300 && response.status < 400
    ? await fetch(new URL(response.headers.get('location'), origin), { headers: { cookie: cookies }, signal: AbortSignal.timeout(5000) }) : response;
  if (!page.ok) throw new Error(`页面 HTTP ${page.status}`);
  const scripts = manifestScripts(await page.text());
  for (const script of scripts) {
    signal?.throwIfAborted();
    const res = await fetch(origin + script, { headers: { cookie: cookies }, signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]) });
    if (!res.ok || !/javascript/.test(res.headers.get('content-type') || '') || !(await res.text()).trim()) throw new Error(`脚本加载失败：${script}（HTTP ${res.status}）`);
  }
  return scripts.length;
}
export function stopTree(child) {
  return new Promise(resolve => {
    if (!child?.pid) return resolve();
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', resolve); killer.once('exit', resolve);
  });
}
export async function scanEach(items, probe, onResult, signal) {
  const results = [];
  for (const item of items) {
    signal?.throwIfAborted();
    let result;
    try { result = await probe(item); } catch (e) {
      if (signal?.aborted) throw e;
      result = { status: 'unknown', reason: e.message };
    }
    results.push({ id: item.id, ...result });
    onResult?.(item, result);
  }
  return results;
}
export async function scanParallel(items, probe, onResult, signal, concurrency = 3) {
  const results = new Array(items.length); let cursor = 0;
  const workers = Array.from({length: Math.min(Math.max(1, concurrency), items.length)}, async () => {
    while (cursor < items.length) {
      signal?.throwIfAborted();
      const index = cursor++, item = items[index]; let result;
      try { result = await probe(item); } catch (e) {
        if (signal?.aborted) throw e;
        result = {status:'unknown',reason:e.message};
      }
      results[index] = {id:item.id,...result}; onResult?.(item,result);
    }
  });
  const settled = await Promise.allSettled(workers); // Wait for every in-flight probe's cleanup even on cancellation.
  signal?.throwIfAborted();
  const failed = settled.find(r=>r.status==='rejected'); if(failed)throw failed.reason;
  return results;
}
export async function probe(p, inventory, selected, label, signal, timeout = 90000) {
  const parentSignal = signal;
  signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
  const runId = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const scratch = path.join(p.launcher, 'checks', runId);
  const home = path.join(scratch, 'home');
  const profile = path.join(home, 'profiles/web');
  const work = path.join(scratch, 'workspace');
  const logFile = path.join(p.launcher, 'check-logs', runId + '.log');
  fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const chosen = inventory.items.filter(i => selected.includes(i.id));
  const manifest = structuredClone(inventory.manifest);
  manifest.dsh.profile.bundles = [...inventory.core, ...chosen.filter(i => i.kind === 'bundle').map(i => i.id)];
  manifest.dependencies = { ...manifest.dependencies };
  for (const item of inventory.items) if (item.kind === 'bundle' && !selected.includes(item.id)) delete manifest.dependencies[item.id];
  writeJson(path.join(profile, 'package.json'), manifest);
  fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n');
  // Packages are linked, not copied. Probe isolation is not a security sandbox.
  for (const name of Object.keys(manifest.dependencies)) {
    const source = path.join(p.profile, 'node_modules', name);
    if (fs.existsSync(source)) {
      const target = path.join(profile, 'node_modules', name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(source, target, 'junction');
    }
  }
  const rows = chosen.filter(i => i.kind === 'patch').map(i => ({ ...i.row, disabled: false }));
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), rows.length ? yamlFor(p.repo).dump([{ insert: rows }]) : '[]\n');
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ProgramFiles', 'ProgramFiles(x86)']) if (process.env[key]) env[key] = process.env[key];
  env.DSH_HOME = home; env.DSH_TELEMETRY_DISABLED = '1';
  let output = '', errors = '', exited = false, spawnError;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(p.launcher, 'Probe-Process.ps1'), '-NodePath', process.execPath, '-Entry', p.entry], { cwd: work, env, windowsHide: true });
  const log = fs.createWriteStream(logFile);
  log.write(`Check: ${label}\n`);
  child.stdout.on('data', b => { output = (output + b).slice(-1000000); log.write(b); });
  child.stderr.on('data', b => { errors = (errors + b).slice(-1000000); log.write(b); });
  child.once('error', e => { spawnError = e; exited = true; });
  child.once('exit', () => { exited = true; });
  let result = { status: 'unknown', reason: '检查超时，未确认兼容性', log: logFile };
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (exited) { result = { status: 'failed', reason: spawnError?.message || errorSummary(errors), log: logFile }; break; }
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/);
      if (match) {
        try {
          const count = await health(match[1], signal);
          await delay(600, undefined, { signal });
          if (exited) throw new Error(errorSummary(errors));
          result = { status: 'passed', reason: `独立加载通过，${count} 个启动资源正常`, log: logFile }; break;
        } catch (e) { if (signal.aborted) throw e; result = { status: 'failed', reason: e.message, log: logFile }; break; }
      }
      await delay(300, undefined, { signal });
    }
  } catch (e) {
    if (parentSignal?.aborted) throw e;
    result = { status: 'unknown', reason: signal.aborted ? '检查超时，未确认兼容性' : e.message, log: logFile };
  } finally {
    await stopTree(child);
    log.end();
    // Only delete this freshly created run directory, never follow package junctions.
    for (const name of Object.keys(manifest.dependencies)) {
      const target = path.join(profile, 'node_modules', name);
      try { if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target); } catch {}
    }
    const checksRoot = path.resolve(p.launcher, 'checks') + path.sep;
    if (!path.resolve(scratch).startsWith(checksRoot)) throw new Error('临时目录边界检查失败');
    try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
  parentSignal?.throwIfAborted();
  return result;
}
export function applySelection(p, inventory, selected) {
  const fresh = discover(p);
  if (fresh.signature !== inventory.signature) throw new Error('插件或配置已变化，请重新检查');
  const ids = new Set(fresh.items.map(i => i.id));
  if (selected.some(id => !ids.has(id))) throw new Error('选择包含未知插件');
  const manifestPath = path.join(p.profile, 'package.json');
  const manifest = structuredClone(fresh.manifest);
  manifest.dsh.profile.bundles = [...fresh.core, ...fresh.items.filter(i => i.kind === 'bundle' && selected.includes(i.id)).map(i => i.id)];
  const overlays = fresh.items.filter(i => i.kind === 'patch').map(i => ({ id: i.rowId, disabled: !selected.includes(i.id) }));
  const overlayFile = path.join(p.launcher, 'selected-plugins.yml');
  const previousOverlay = fs.existsSync(overlayFile) ? fs.readFileSync(overlayFile) : null;
  fs.mkdirSync(path.join(p.launcher, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(p.launcher, 'backups', `profile-${Date.now()}.json`), fresh.raw);
  const changed = JSON.stringify(fresh.manifest.dsh.profile.bundles) !== JSON.stringify(manifest.dsh.profile.bundles)
    || String(previousOverlay || '') !== yamlFor(p.repo).dump(overlays);
  fs.writeFileSync(overlayFile, yamlFor(p.repo).dump(overlays), 'utf8');
  try {
    writeJson(manifestPath, manifest);
    writeJson(path.join(p.launcher, 'selection.json'), { selected: Object.fromEntries(fresh.items.map(i => [i.id, selected.includes(i.id)])), savedAt: new Date().toISOString() });
  } catch (e) {
    fs.writeFileSync(manifestPath, fresh.raw);
    if (previousOverlay) fs.writeFileSync(overlayFile, previousOverlay); else fs.unlinkSync(overlayFile);
    throw e;
  }
  return { changed, rollback() {
    if (fs.readFileSync(manifestPath, 'utf8') !== JSON.stringify(manifest, null, 2) + '\n') throw new Error('正式配置被其他程序修改，未自动覆盖');
    fs.writeFileSync(manifestPath, fresh.raw);
    if (previousOverlay) fs.writeFileSync(overlayFile, previousOverlay); else fs.unlinkSync(overlayFile);
  } };
}
