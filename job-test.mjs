import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir=path.dirname(fileURLToPath(import.meta.url));
const fixture=path.join(dir,'job-fixture.cjs');
fs.writeFileSync(fixture,`const {spawn}=require('child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true}); console.log('GRANDCHILD='+c.pid); c.unref(); setTimeout(()=>process.exit(1),500);`);
let out='',err='';
const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'Probe-Process.ps1'),'-NodePath',process.execPath,'-Entry',fixture];
if(process.argv.includes('--formal'))args.push('-RuntimePatch',path.join(dir,'fixture-patch.yml'));
const child=spawn('powershell.exe',args,{windowsHide:true});
child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
await new Promise((r,j)=>{child.on('error',j);child.on('close',r)});
try {
 const pid=out.match(/GRANDCHILD=(\d+)/)?.[1];assert.ok(pid,err||out);
 const alive=execFileSync('powershell.exe',['-NoProfile','-Command',`[bool](Get-Process -Id ${pid} -ErrorAction SilentlyContinue)`],{windowsHide:true,encoding:'utf8'}).trim();
 assert.equal(alive,'False');console.log('PASS: orphan grandchild terminated when probe parent exited');
} finally {fs.unlinkSync(fixture)}
