#!/usr/bin/env node
import { spawn } from 'child_process';

const HANG_COMMAND = 'Write-Output "pre"; Wait-Event -SourceIdentifier never -Timeout 20; Write-Output "post"';

function startServer(){
  const env = { ...process.env };
  const proc = spawn(process.execPath, ['dist/server.js'], { stdio: ['pipe','pipe','pipe'], env });
  return proc;
}

async function waitForReady(proc, timeoutMs=4000){
  return new Promise((resolve, reject)=>{
    const to = setTimeout(()=> reject(new Error('timeout waiting for server ready')), timeoutMs);
    proc.stderr.on('data', d=> { if(d.toString().includes('SERVER CONNECTED')){ clearTimeout(to); resolve(); } });
    proc.on('exit', c=> { clearTimeout(to); reject(new Error('server exited early '+c)); });
  });
}

function send(proc, obj){ proc.stdin.write(JSON.stringify(obj)+'\n'); }

async function run(){
  const server = startServer();
  await waitForReady(server);
  let buf='';
  const responses = {};
  server.stdout.on('data', d=> {
    buf += d.toString();
    const lines = buf.split(/\n/); buf = lines.pop();
    for(const line of lines){
      if(!line.trim()) continue;
      try { const msg = JSON.parse(line); if(msg.id) { responses[msg.id]=msg; if(msg.id==='hang1'){ finish(msg); } } } catch {}
    }
  });
  const params = { name:'run-powershell', arguments:{ command: HANG_COMMAND, confirmed:true, aiAgentTimeoutSec:2, progressAdaptive:true, adaptiveExtendWindowMs:1500, adaptiveExtendStepMs:1500, adaptiveMaxTotalSec:8 } };
  send(server,{ jsonrpc:'2.0', id:'hang1', method:'tools/call', params });
  function finish(msg){
    const sc = msg.result?.structuredContent || {}; const previewStdout = (msg.result?.content||[]).map(c=>c.text||'').join('\n');
    const out = { timedOut: sc.timedOut, terminationReason: sc.terminationReason, configuredTimeoutMs: sc.configuredTimeoutMs, effectiveTimeoutMs: sc.effectiveTimeoutMs, adaptiveExtensions: sc.adaptiveExtensions, stdoutPreview: previewStdout.slice(0,120), internalSelfDestruct: sc.internalSelfDestruct, exitCode: sc.exitCode, psProcessMetrics: sc.psProcessMetrics };
    console.log('HANG_TEST_RESULT:'+JSON.stringify(out,null,2));
    server.kill();
  }
  // Safety timeout
  setTimeout(()=>{ console.error('No response before timeout'); try { server.kill(); } catch {}; }, 30000);
}

run().catch(e=> { console.error('run-hang-test error', e); process.exit(1); });