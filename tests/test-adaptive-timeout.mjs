#!/usr/bin/env node
// Adaptive timeout behavior test
import { spawn } from 'child_process';

function send(p, obj){ p.stdin.write(JSON.stringify(obj)+'\n'); }

const server = spawn('node',['dist/server.js'],{stdio:['pipe','pipe','pipe']});
server.stderr.on('data', d=> process.stderr.write(d));
let start;

server.stdout.on('data', data => {
  data.toString().trim().split(/\r?\n/).forEach(line=>{
    if(!line) return; let msg; try{ msg = JSON.parse(line); }catch{return; }
    if(msg.id===1){
      start = Date.now();
      send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'run-powershell', arguments:{ command:'1..12 | ForEach-Object { Start-Sleep -Milliseconds 900; Write-Output "STEP$_" }', confirmed:true, aiAgentTimeoutSec:5, adaptiveTimeout:true, adaptiveExtendWindowMs:1500, adaptiveExtendStepMs:3000, adaptiveMaxTotalSec:20 }}});
    } else if(msg.id===2){
      const sc = msg.result?.structuredContent || {};
      const elapsed = Date.now()-start;
      const passed = sc.adaptiveExtensions > 0 && sc.effectiveTimeoutMs > (5*1000) && sc.stdout.includes('STEP12');
      console.log(JSON.stringify({ test:'adaptive-timeout', elapsedMs: elapsed, adaptiveExtensions: sc.adaptiveExtensions, effectiveTimeoutMs: sc.effectiveTimeoutMs, maxTotal: sc.adaptiveMaxTotalMs, passed }));
      if(!passed){ process.exitCode = 1; }
      server.kill();
    }
  });
});

send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'adaptive-test', version:'1.0.0' }}});

setTimeout(()=>{ console.error('Adaptive timeout test did not complete'); server.kill(); process.exit(1); }, 30000);
