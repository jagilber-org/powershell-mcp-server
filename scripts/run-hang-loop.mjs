#!/usr/bin/env node
// Invokes the run-powershell tool with an infinite ReadKey loop to exercise timeout handling.
// Default timeout kept very small (1s) to avoid long hangs. Adjust with HANG_TIMEOUT_SEC env var.

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const timeoutSec = parseFloat(process.env.HANG_TIMEOUT_SEC || '1');
const psCommand = 'while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }';

const server = spawn('node', ['dist/server.js'], { stdio: ['pipe','pipe','pipe'] });

let connected = false;
let overallTimer;

function shutdown(code=0){
  clearTimeout(overallTimer);
  try{ server.kill(); }catch{}
  process.exit(code);
}

overallTimer = setTimeout(()=>{
  console.error('[hang-script] Overall timeout exceeded (5s)');
  shutdown(2);
}, 5000 + (timeoutSec*1000));

readline.createInterface({ input: server.stderr }).on('line', line => {
  if(!connected && /SERVER CONNECTED/i.test(line)){
    connected = true;
    const req = {
      jsonrpc: '2.0',
      id: 'hang1',
      method: 'tools/call',
      params: {
        name: 'run-powershell',
        arguments: {
          command: psCommand,
          timeout: timeoutSec,
          confirmed: true
        }
      }
    };
    server.stdin.write(JSON.stringify(req)+'\n');
  }
});

readline.createInterface({ input: server.stdout }).on('line', line => {
  let obj; try { obj = JSON.parse(line); } catch { return; }
  if(obj.id === 'hang1'){
    console.log('\n=== hang tool response ===');
    console.log(JSON.stringify(obj, null, 2));
    const sc = obj.result?.structuredContent || {}; 
    console.log('\nSummary:', {
      timedOut: sc.timedOut,
      exitCode: sc.exitCode,
      success: sc.success,
      durationMs: sc.durationMs,
      configuredTimeoutMs: sc.configuredTimeoutMs
    });
    shutdown(0);
  }
});

server.on('exit', (code, signal)=>{
  if(!connected){
    console.error('[hang-script] server exited before connection', { code, signal });
    shutdown(1);
  }
});
