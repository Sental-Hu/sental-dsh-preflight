import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover, applySelection, scanEach, scanParallel, manifestScripts, yamlFor, readJson, writeJson, health } from './engine.mjs';
import { CACHE_SCHEMA, fingerprintInventory, planChecks, cacheHit, combinationKey } from './cache.mjs';
import { validRequest } from './security.mjs';
import http from 'node:http';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fixture-repo-'));
writeJson(path.join(repo, 'package.json'), { name: 'fixture-host', version: '1.0.0' });
test.after(() => { assert.ok(path.resolve(repo).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(repo, { recursive: true, force: true }); });
test('parallel checks are bounded to three and collect every result in input order', async () => {
  let active=0,peak=0;
  const results=await scanParallel(Array.from({length:7},(_,id)=>({id})),async item=>{
    active++;peak=Math.max(peak,active);
    try{await new Promise(r=>setTimeout(r,10));if(item.id===1)throw Error('bad plugin');return {status:item.id===3?'failed':'passed'};}finally{active--;}
  },null,null,3);
  assert.equal(peak,3);assert.equal(active,0);assert.deepEqual(results.map(i=>i.id),[0,1,2,3,4,5,6]);
  assert.equal(results[1].status,'unknown');assert.equal(results[3].status,'failed');
});
test('parallel cancellation waits for all active cleanup and starts no queued work',async()=>{
  const c=new AbortController();let started=0,active=0;
  await assert.rejects(scanParallel(Array.from({length:8},(_,id)=>({id})),async()=>{
    started++;active++;try{await new Promise(r=>setTimeout(r,10));c.abort();return {status:'passed'};}finally{active--;}
  },null,c.signal,3));
  assert.equal(started,3);assert.equal(active,0);
});
test('fingerprints invalidate only changed plugin; host changes invalidate all; choice does not',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-cache-test-'));
  const p={repo:path.join(root,'repo'),launcher:path.join(root,'launcher')};
  try{
    writeJson(path.join(p.repo,'package.json'),{name:'host',version:'1'});
    fs.mkdirSync(path.join(p.repo,'apps/cli/lib'),{recursive:true});fs.writeFileSync(path.join(p.repo,'apps/cli/lib/bin.js'),'host1');
    const items=['a','b'].map(id=>{const dir=path.join(root,id);writeJson(path.join(dir,'package.json'),{name:id,version:'1'});fs.mkdirSync(path.join(dir,'lib'));fs.writeFileSync(path.join(dir,'lib/index.js'),id);return {id,name:id,version:'1',dir};});
    items.push({id:'patch:mcp',name:'mcp',version:'config',row:{id:'mcp',name:'mcp',config:{value:1}}});
    const inventory={core:['core'],items,patches:[]};
    const fresh=()=>{const inv=structuredClone(inventory);Object.assign(inv,fingerprintInventory(p,inv,[]));return inv;};
    let inv=fresh();const cache={schema:CACHE_SCHEMA,base:{key:inv.baseKey,result:{status:'passed'}},items:Object.fromEntries(inv.items.map(i=>[i.id,{key:i.checkKey,result:{status:i.id==='b'?'failed':'passed'}}]))};
    assert.deepEqual(planChecks(fresh(),cache),{base:false,items:[]});
    const combo=combinationKey(inv,['a']);
    inventory.items[0].selected=false;inventory.items[1].enabled=false;
    assert.equal(combinationKey(fresh(),['a']),combo);assert.equal(planChecks(fresh(),cache).items.length,0);
    fs.writeFileSync(path.join(items[1].dir,'lib/index.js'),'b changed');
    inv=fresh();assert.deepEqual(planChecks(inv,cache).items.map(i=>i.id),['b']);assert.equal(planChecks(inv,cache).base,false);assert.equal(combinationKey(inv,['a']),combo);
    inventory.items[2].row.config.value=2;assert.deepEqual(planChecks(fresh(),cache).items.map(i=>i.id),['b','patch:mcp']);
    fs.writeFileSync(path.join(p.repo,'apps/cli/lib/bin.js'),'host changed');inv=fresh();assert.equal(planChecks(inv,cache).base,true);assert.equal(planChecks(inv,cache).items.length,3);
    assert.equal(planChecks(inv,cache,true).items.length,3);
    assert.equal(cacheHit({key:'x',result:{status:'failed'}},'x'),true);
    assert.equal(cacheHit({key:'x',result:{status:'unknown'}},'x'),true);
    assert.equal(cacheHit({key:'x',result:{status:'passed'}},'x',true),false);
  }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
test('scan collects multiple independent failures and continues after thrown error', async () => {
  const rows = await scanEach([{ id: 'a' }, { id: 'b' }, { id: 'c' }], async i => { if (i.id === 'b') throw Error('timeout'); return { status: i.id === 'a' ? 'failed' : 'passed' }; });
  assert.deepEqual(rows.map(i => i.status), ['failed', 'unknown', 'passed']);
});
test('cancel prevents subsequent probes', async () => {
  const c = new AbortController(); let count = 0;
  await assert.rejects(scanEach([{ id: 'a' }, { id: 'b' }], async () => { count++; c.abort(); return { status: 'failed' }; }, null, c.signal));
  assert.equal(count, 1);
});
test('JS expressions survive parse/dump across calls without evaluation', () => {
  const text = '- insert:\n    - id: mcp\n      name: example\n      config:\n        cwd: !!js process.cwd()\n';
  const rows = yamlFor(repo).load(text);
  assert.match(yamlFor(repo).dump(rows), /!!js process.cwd\(\)/);
});
test('manifest supports both formats and rejects missing or external scripts', () => {
  for (const prefix of ['window.__DSH_BOOT__','globalThis["__DSH_BOOT__"]']) {
    assert.deepEqual(manifestScripts(`<script>${prefix}={"entries":[{"url":"/a.js"}],"batches":[{"url":"/b.js"}]};</script><script src="./c.js"></script>`), ['/a.js','/b.js','/c.js']);
  }
  assert.throws(() => manifestScripts('<html>OK</html>'));
  assert.throws(() => manifestScripts('<script>window.__DSH_BOOT__={"entries":[{"url":"https://other/a.js"}]}</script>'));
});
test('health rejects HTML fallback even when script HTTP status is 200', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type','text/html');
    res.end(req.url === '/' ? '<script>window.__DSH_BOOT__={"entries":[{"url":"/broken.js"}]}</script>' : '<html>fallback</html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await assert.rejects(health(`http://127.0.0.1:${server.address().port}/`), /脚本加载失败/); }
  finally { server.close(); }
});
test('loopback API requires token, matching host and same origin', () => {
  const req = {url:'/?key=secret',headers:{host:'127.0.0.1:1234'}};
  assert.equal(validRequest(req,'http://127.0.0.1:1234','secret'),true);
  for (const bad of [{...req,url:'/'},{...req,headers:{...req.headers,origin:'https://evil.test'}},{...req,headers:{host:'evil.test:1234'}}]) assert.equal(validRequest(bad,'http://127.0.0.1:1234','secret'),false);
});
test('disabled installed plugins stay discoverable; selections preserve fields and detect races', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-launcher-test-'));
  const p = {home:path.join(root,'home'),profile:path.join(root,'home/profiles/web'),launcher:path.join(root,'launcher'),repo,entry:path.join(repo,'apps/cli/lib/bin.js')};
  try {
    const manifest = { name:'test-profile', custom:{keep:42}, dependencies:{'plugin-a':'1','plugin-b':'1'}, dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','plugin-a']}}};
    writeJson(path.join(p.profile,'package.json'),manifest);
    for (const name of ['plugin-a','plugin-b']) writeJson(path.join(p.profile,'node_modules',name,'package.json'),{name,version:'1',dsh:{bundle:{patch:'cordis.patch.yml'}}});
    fs.writeFileSync(path.join(p.profile,'cordis.patch.yml'),'# keep comment\n- insert:\n    - id: local\n      name: local-plugin\n');
    let inv = discover(p);
    assert.equal(inv.items.length,3); assert.equal(inv.items.find(i=>i.id==='plugin-b').selected,false);
    const originalPatch = fs.readFileSync(path.join(p.profile,'cordis.patch.yml'),'utf8');
    const tx = applySelection(p,inv,['plugin-b']);
    const changed=readJson(path.join(p.profile,'package.json'));
    assert.deepEqual(changed.custom,manifest.custom);assert.deepEqual(changed.dependencies,manifest.dependencies);
    assert.deepEqual(changed.dsh.profile.bundles,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','plugin-b']);
    assert.equal(fs.readFileSync(path.join(p.profile,'cordis.patch.yml'),'utf8'),originalPatch);
    assert.equal(discover(p).items.find(i=>i.id==='plugin-b').selected,true);
    tx.rollback();assert.deepEqual(readJson(path.join(p.profile,'package.json')),manifest);
    fs.unlinkSync(path.join(p.launcher,'selection.json'));
    fs.mkdirSync(path.join(p.launcher,'selection.json')); // Simulate selection persistence failing after manifest write.
    assert.throws(()=>applySelection(p,discover(p),['plugin-b']));
    assert.deepEqual(readJson(path.join(p.profile,'package.json')),manifest);
    assert.equal(fs.existsSync(path.join(p.launcher,'selected-plugins.yml')),false);
    fs.rmdirSync(path.join(p.launcher,'selection.json'));
    inv=discover(p);const edit=readJson(path.join(p.profile,'package.json'));edit.custom.keep=43;writeJson(path.join(p.profile,'package.json'),edit);
    assert.throws(()=>applySelection(p,inv,[]),/已变化/);
    assert.equal(readJson(path.join(p.profile,'package.json')).custom.keep,43);
  } finally { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true}); }
});
