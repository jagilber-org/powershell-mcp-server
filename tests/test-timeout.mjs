#!/usr/bin/env n
// Test that a long-running PowerShell command is forcibly timed out and reported.
import { spawn } from 'child_process';

function send(proc, obj) { proc.stdin.write(JSON.stringify(obj)+'\n'); }

const server = spawn('node',['dist/server.js'],{stdio:['pipe','pipe','pipe']});
server.stderr.on('data', d=>process.stderr.write(d));

let gotResponse = false;
let start;

server.stdout.on('data', d=>{
  d.toString().trim().split(/\r?\n/).forEach(line=>{ if(!line) return; try { const m=JSON.parse(line);
    if(m.id===1){
      // initialize done -> fire long command with tiny timeout (1s)
      start = Date.now();
  // Use correct tool name and specify timeout in seconds (1s)
  send(server,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'run-powershell',arguments:{command:'Start-Sleep -Seconds 5; Write-Output "FINISHED"',confirmed:true,timeoutSeconds:1}}});
    } else if (m.id===2){
      gotResponse = true;
      const elapsed = Date.now()-start;
      const sc = m.result?.structuredContent || {};
      const timedOutFlag = !!sc.timedOut;
      console.log('Timeout test response elapsed='+elapsed+'ms, timedOut='+timedOutFlag+' exit='+sc.exitCode);
      if(!timedOutFlag){
        console.error('❌ Expected timedOut true in structuredContent');
        process.exit(1);
      }
      if(elapsed < 600 || elapsed > 4000){
        console.error('⚠️ Elapsed time outside expected bounds: '+elapsed+'ms');
      } else {
        console.log('✅ Timeout elapsed within expected range');
      }
      if(sc.configuredTimeoutMs !== 1000){ console.error('⚠️ configuredTimeoutMs unexpected (expected 1000):', sc.configuredTimeoutMs); }
      if(sc.duration_ms < 600 || sc.duration_ms > 4000){ console.error('⚠️ duration_ms out of expected range', sc.duration_ms); }
      server.kill();
    }
  } catch(e){ /* ignore parse errors */ } });
});

send(server,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'timeout-test',version:'1.0.0'}}});

// Safety: force exit if no response
setTimeout(()=>{ if(!gotResponse){ console.error('❌ Did not receive timeout response in time'); server.kill(); process.exit(1);} }, 12000);
