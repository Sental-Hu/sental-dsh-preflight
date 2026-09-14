import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

export const CACHE_SCHEMA = 2;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const stores = new Map();
function memoFor(dir) {
  if (!stores.has(dir)) {
    let files = {};
    try { files = JSON.parse(fs.readFileSync(path.join(dir, 'fingerprints.json'), 'utf8')).files || {}; } catch {}
    stores.set(dir, { files, touched: new Set() });
  }
  return stores.get(dir);
}
export function fingerprintFile(file, memo) {
  const key = path.resolve(file);
  let stat;
  try { stat = fs.statSync(key); } catch { return 'missing:' + key; }
  if (!stat.isFile()) return 'not-file:' + key;
  const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
  memo.touched.add(key);
  if (memo.files[key]?.stamp === stamp) return memo.files[key].hash;
  const hash = digest(fs.readFileSync(key));
  memo.files[key] = { stamp, hash };
  return hash;
}
function tree(root, memo, packageMode = false) {
  if (!fs.existsSync(root)) return 'missing:' + root;
  const parts = [];
  function walk(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git', '.pnpm-store', '__pycache__'].includes(entry.name)) continue;
      if (/\.d\.[cm]?ts$|\.map$/.test(entry.name)) continue;
      const rel = path.join(relative, entry.name), file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (relative === 'lib' && entry.name === 'types') continue;
        if (!relative && packageMode && !['lib','dist','assets','prompts','presets','profiles','schemas','resources'].includes(entry.name)) continue;
        walk(file, rel);
      } else if (entry.isFile()) {
        if (!relative && packageMode && !/^(package\.json|cordis.*\.ya?ml|dsh\.plugin\.json)$/.test(entry.name)) continue;
        parts.push(rel + ':' + fingerprintFile(file, memo));
      } else if (entry.isSymbolicLink()) parts.push(rel + ':link:' + fs.readlinkSync(file));
    }
  }
  walk(root);
  return digest(parts.join('\n'));
}
function packageDir(name, from) {
  const require = createRequire(path.join(from, 'package.json'));
  try { return path.dirname(require.resolve(name + '/package.json')); } catch {}
  try {
    let dir = path.dirname(require.resolve(name));
    while (path.dirname(dir) !== dir) {
      try { if (JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')).name === name) return dir; } catch {}
      dir = path.dirname(dir);
    }
  } catch {}
  return null;
}
function dependencyTree(root, memo, visited) {
  const canonical = fs.realpathSync(root);
  if (visited.has(canonical)) return 'ref:' + canonical;
  visited.add(canonical);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const parts = [canonical, tree(root, memo)];
  for (const name of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies }).sort()) {
    if (name.startsWith('@deepseek-ai/')) continue; // Host packages are included in the shared fingerprint.
    const dir = packageDir(name, root);
    parts.push(name + ':' + (dir ? dependencyTree(dir, memo, visited) : 'missing'));
  }
  return digest(parts.join('\n'));
}
export function fingerprintInventory(p, inventory, commonPatches) {
  const memo = memoFor(p.launcher); memo.touched.clear();
  const host = [CACHE_SCHEMA, process.execPath, process.version, p.repo, p.home];
  for (const file of ['engine.mjs','cache.mjs','config.mjs','Probe-Process.ps1','Runtime-DSH.ps1','package-lock.json']) {
    host.push(file + ':' + fingerprintFile(path.join(p.launcher, file), memo));
  }
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml']) host.push(name + ':' + fingerprintFile(path.join(p.repo, name), memo));
  host.push(tree(path.join(p.repo, 'apps/cli'), memo, true));
  // Track built code and runtime resources, not source/tests/docs or changing session data.
  for (const family of ['packages','vendor']) {
    const root = path.join(p.repo, family);
    if (!fs.existsSync(root)) continue;
    for (const group of fs.readdirSync(root, { withFileTypes: true }).filter(i => i.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
      const groupDir = path.join(root, group.name);
      if (family === 'vendor' || fs.existsSync(path.join(groupDir, 'package.json'))) host.push(tree(groupDir, memo, true));
      else for (const pkg of fs.readdirSync(groupDir, { withFileTypes: true }).filter(i=>i.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) host.push(group.name+'/'+pkg.name+':'+tree(path.join(groupDir,pkg.name),memo,true));
    }
  }
  const hostKey = digest(host.join('\n'));
  const baseKey = digest(JSON.stringify([hostKey, inventory.core, commonPatches]));
  for (const item of inventory.items) {
    const local = item.dir && fs.existsSync(item.dir) ? dependencyTree(item.dir, memo, new Set()) : item.missing ? 'missing' : '';
    const row = item.row ? { ...item.row, disabled: false } : null;
    item.checkKey = digest(JSON.stringify([baseKey, item.id, item.name, item.version, local, row]));
  }
  const file = path.join(p.launcher, 'fingerprints.json');
  fs.mkdirSync(p.launcher, { recursive: true });
  const files = Object.fromEntries([...memo.touched].map(key => [key, memo.files[key]]));
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({files})); fs.renameSync(tmp,file);
  return { hostKey, baseKey };
}
export function cacheHit(record, key, force = false) {
  return !force && record?.key === key && ['passed','failed','unknown'].includes(record.result?.status);
}
export function combinationKey(inventory, selected) {
  return digest(JSON.stringify([inventory.baseKey, inventory.items.filter(i=>selected.includes(i.id)).map(i=>[i.id,i.checkKey])]));
}
export function planChecks(inventory, cache, force = false) {
  if (cache?.schema !== CACHE_SCHEMA) cache = {};
  return {
    base: !cacheHit(cache.base, inventory.baseKey, force),
    items: inventory.items.filter(i => !cacheHit(cache.items?.[i.id], i.checkKey, force)),
  };
}
