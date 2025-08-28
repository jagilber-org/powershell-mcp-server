import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const sandbox = join(process.cwd(), 'sandbox-demo');
try { mkdirSync(sandbox, { recursive: true }); } catch {}
writeFileSync(join(sandbox,'marker.txt'),'hello');

console.error('[demo] sandbox directory:', sandbox);

const server = spawn(process.execPath, ['dist/server.js'], { stdio: ['pipe','pipe','pipe'] });
server.stderr.setEncoding('utf8');
server.stdout.setEncoding('utf8');

let stdoutBuf='';
let ready=false;

function sendDemoRequest(){
  const req = {
    jsonrpc:'2.0', id:'demo1', method:'tools/call',
    params:{ name:'run-powershell', arguments:{
      command:'Write-Output "PWD=$(Get-Location)"; Get-ChildItem -Name; Start-Sleep -Seconds 3; Write-Output "AFTER"',
      confirmed:true,
      workingDirectory: sandbox,
      timeout:1
    } }
  };
  server.stdin.write(JSON.stringify(req)+'\n');
  console.error('[demo] request sent');
}

server.stderr.on('data', d=>{
  process.stderr.write(d);
  if(!ready && d.includes('SERVER CONNECTED')){ ready=true; sendDemoRequest(); }
});

server.stdout.on('data', d=>{
  stdoutBuf += d;
  const lines = stdoutBuf.split(/\n/); stdoutBuf = lines.pop();
  for(const line of lines){
    if(!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if(msg.id==='demo1'){
        console.log('--- RESPONSE (demo1) ---');
        console.log(JSON.stringify(msg,null,2));
        console.log('--- END RESPONSE ---');
        setTimeout(()=> server.kill(), 400);
      }
    } catch {}
  }
});

server.on('exit', code=>{
  console.error('[demo] server exited code', code);
});
