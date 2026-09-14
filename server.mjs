import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { paths, discover, probe, scanParallel, readJson, writeJson, applySelection, errorSummary } from './engine.mjs';
import { validRequest } from './security.mjs';
import { CACHE_SCHEMA, planChecks, cacheHit, combinationKey } from './cache.mjs';
import { loadConfig } from './config.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(dir);
const repo = config.repo;
const p = paths(dir, repo, config.home);
const token = crypto.randomBytes(32).toString('hex');
let inventory, active, abort, lastSeen = Date.now(), origin, quitting = false;
const state = { phase: 'idle', message: '准备检查', items: [], complete: 0, total: 0, base: null, error: '', url: '', checkedAt: '' };

function loadCache() {
  try { const c=readJson(path.join(dir,'check-cache.json'));if(c.schema===CACHE_SCHEMA)return c; } catch {}
  return {schema:CACHE_SCHEMA,items:{},combinations:{}};
}
function saveCache(cache) { writeJson(path.join(dir,'check-cache.json'),cache); }
async function scan(force = false) {
  state.phase = 'scanning'; state.error = ''; state.url = ''; state.complete = 0;
  abort = new AbortController();
  try {
    inventory = discover(p);
    const cache=loadCache(), plan=planChecks(inventory,cache,force);
    if(force){cache.items={};cache.combinations={};delete cache.base;saveCache(cache);}
    state.items = inventory.items.map(({ id, name, version, description, selected, checkKey }) => {
      const previous=cache.items[id];
      return {id,name,version,description,selected,status:'pending',reason:'新增或发生变化，等待检查',...(cacheHit(previous,checkKey,force)?{...previous.result,cached:true,checkedAt:previous.checkedAt}:{} )};
    });
    state.total = state.items.length + 1;
    state.base = plan.base ? null : {...cache.base.result,cached:true,checkedAt:cache.base.checkedAt};
    state.complete = state.items.filter(i=>i.cached).length+(plan.base?0:1);
    state.cachedCount=state.complete;
    const pending=[...(plan.base?[{id:'__base',name:'DSH 基础环境'}]:[]),...plan.items];
    state.message=pending.length?`并行检查 ${pending.length} 项，复用 ${state.cachedCount} 项结果`:'没有变化，已恢复上次全部检查结论';
    await scanParallel(pending, async item => {
      if(item.id!=='__base'){const row=state.items.find(i=>i.id===item.id);row.status='checking';row.reason='独立进程试加载中';}
      if(item.missing)return {status:'failed',reason:'插件安装文件缺失'};
      return probe(p,inventory,item.id==='__base'?[]:[item.id],item.name,abort.signal);
    }, (item,result)=>{
      const checkedAt=new Date().toISOString();
      if(item.id==='__base'){
        state.base={...result,cached:false,checkedAt};cache.base={key:inventory.baseKey,result,checkedAt};
      }else{
        Object.assign(state.items.find(i=>i.id===item.id),result,{cached:false,checkedAt});
        cache.items[item.id]={key:item.checkKey,result,checkedAt};
      }
      state.complete++;saveCache(cache);
    },abort.signal,3);
    for(const row of state.items)if(state.base.status!=='passed'&&row.status!=='passed'){
      row.status='unknown';row.reason='基础环境未通过，无法确定此插件兼容性。'+row.reason;
    }
    if (discover(p).signature !== inventory.signature) throw new Error('检查期间插件或配置发生变化，请重新检查');
    state.phase = 'ready'; state.checkedAt = new Date().toISOString();
    state.message = pending.length ? `检查完成：重查 ${pending.length} 项，复用 ${state.cachedCount} 项` : '没有变化，已恢复上次全部检查结论';
    writeJson(path.join(dir, 'last-check.json'), { signature: inventory.signature, checkedAt: state.checkedAt, base: state.base, items: state.items });
  } catch (e) { state.phase = 'error'; state.error = e.message; state.message = '检查未完成'; }
}
function runRuntime(restart, quickHealth = false) {
  return new Promise((resolve, reject) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'Runtime-DSH.ps1'), '-NoOpen', '-NoDialog'];
    if (restart) args.push('-Restart');
    if (quickHealth) args.push('-QuickHealth');
    const child = spawn('powershell.exe', args, { cwd: dir, windowsHide: true, env: { ...process.env, DSH_LAUNCHER_REPO: repo, DSH_HOME: p.home } });
    let text = '';
    child.stdout.on('data', b => { text += b; }); child.stderr.on('data', b => { text += b; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(text.trim().slice(-2500) || `启动进程退出：${code}`)));
  });
}
async function launch(selected) {
  const previousPhase = state.phase;
  if (!inventory || !['ready', 'started'].includes(previousPhase)) throw new Error('请先完成全部检查');
  if (!Array.isArray(selected) || selected.some(x => typeof x !== 'string' || !inventory.items.some(i => i.id === x))) throw new Error('无效的插件选择');
  if (discover(p).signature !== inventory.signature) throw new Error('插件或配置已变化，请重新检查');
  state.phase = 'starting'; state.error = ''; state.url = ''; abort = new AbortController();
  for (const row of state.items) row.selected = selected.includes(row.id);
  let transaction;
  try {
    const cache=loadCache(),key=combinationKey(inventory,selected);
    let record=cache.combinations[key];
    state.message = cacheHit(record,key) ? '所选组合没有变化，复用上次结论' : '正在验证新的或发生变化的插件组合';
    if(!cacheHit(record,key)){
      const result=await probe(p,inventory,selected,'所选插件组合',abort.signal);
      record={key,result,checkedAt:new Date().toISOString()};cache.combinations[key]=record;saveCache(cache);
    }
    const result=record.result;
    if (result.status !== 'passed') throw new Error(`所选组合未通过，正式配置未修改。${result.reason}`);
    transaction = applySelection(p, inventory, selected);
    state.message = '正在正式启动 DeepSeek Harness';
    let runtimeKey;try{runtimeKey=readJson(path.join(dir,'last-runtime.json')).key;}catch{}
    await runRuntime(transaction.changed || runtimeKey !== key,record.formalValidated===true);
    transaction = null; // The running service is the commit point. Bookkeeping cannot roll it back.
    state.phase = 'started'; state.message = '启动成功'; state.url = 'http://127.0.0.1:3080';
    writeJson(path.join(dir,'last-runtime.json'),{key,at:new Date().toISOString()});
    record.formalValidated=true;cache.combinations[key]=record;saveCache(cache);
    const stdout = fs.readFileSync(path.join(dir, 'dsh.stdout.log'), 'utf8');
    const urls = [...stdout.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:3080\/\?token=[A-Za-z0-9_-]+)/g)];
    state.url = urls.at(-1)?.[1] || 'http://127.0.0.1:3080';
    state.phase = 'started'; state.message = '启动成功';
    inventory = discover(p);
    writeJson(path.join(dir, 'last-launch.json'), { at: new Date().toISOString(), selected, status: 'passed' });
  } catch (e) {
    let detail = e.message;
    if (state.phase === 'started') {
      state.message = '启动成功，部分启动记录未能保存'; state.error = e.message;
      try { inventory = discover(p); } catch {}
      return;
    }
    if (transaction) {
      try { transaction.rollback(); detail += '\n已恢复启动前的加载配置；本次勾选已记住。'; } catch (rollbackError) { detail += '\n' + rollbackError.message; }
      try { detail = errorSummary(fs.readFileSync(path.join(dir, 'dsh.stderr.log'), 'utf8')) + '\n' + detail; } catch {}
      inventory = discover(p);
    }
    state.phase = 'ready'; state.error = detail; state.message = '启动未完成，请调整选择';
  }
}
function startTask(job) {
  if (active) throw new Error('检查或启动正在进行');
  active = job().catch(e => { state.error = e.message; state.phase = 'error'; }).finally(() => { active = null; });
}
const html = fs.readFileSync(path.join(dir, 'launcher.html'), 'utf8');
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (!validRequest(req, origin, token)) { res.writeHead(403); return res.end('Forbidden'); }
  lastSeen = Date.now();
  const url = new URL(req.url, origin);
  if (req.method === 'GET' && url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    return res.end(html);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    if (req.method === 'GET' && url.pathname === '/ping') return res.end(JSON.stringify({ kind: 'dsh-plugin-launcher', pid: process.pid }));
    if (req.method === 'GET' && url.pathname === '/state') return res.end(JSON.stringify(state));
    if (req.method !== 'POST') { res.writeHead(404); return res.end('{}'); }
    let body = ''; for await (const part of req) { body += part; if (body.length > 20000) throw new Error('请求过大'); }
    if (url.pathname === '/scan') startTask(()=>scan(JSON.parse(body||'{}').force===true));
    else if (url.pathname === '/launch') {
      const selected = JSON.parse(body || '{}').selected;
      if (!Array.isArray(selected)) throw new Error('缺少插件选择');
      startTask(() => launch(selected));
    } else if (url.pathname === '/close') { res.end('{}'); return shutdown(); }
    else throw new Error('未知操作');
    res.end('{}');
  } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
});
async function shutdown() {
  if (quitting) return; quitting = true;
  // Let an already-started formal launch finish; never orphan its PowerShell supervisor.
  if (state.phase !== 'starting' || state.message !== '正在正式启动 DeepSeek Harness') abort?.abort(new Error('窗口已关闭，检查已取消'));
  await active;
  server.close();
  try { if (readJson(path.join(dir, 'launcher-endpoint.json')).pid === process.pid) fs.unlinkSync(path.join(dir, 'launcher-endpoint.json')); } catch {}
  process.exit(0);
}
server.listen(0, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  writeJson(path.join(dir, 'launcher-endpoint.json'), { url: `${origin}/?key=${token}`, pid: process.pid });
  startTask(scan);
});
setInterval(() => { if (Date.now() - lastSeen > 90000) void shutdown(); }, 10000).unref();
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
