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
      send(server,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'powershell-command',arguments:{command:'Start-Sleep -Seconds 5; Write-Output "FINISHED"',confirmed:true,aiAgentTimeout:1000}}});
    } else if (m.id===2){
      gotResponse = true;
      const elapsed = Date.now()-start;
      const text = (m.result?.content?.[0]?.text)||'';
      const timedOutFlag = /timed out/i.test(text) || /"timedOut":\s*true/.test(text);
      console.log('Timeout test response elapsed='+elapsed+'ms, timedOutDetected='+timedOutFlag);
      if(!timedOutFlag){
        console.error('❌ Expected timeout flag not detected');
        process.exit(1);
      } else if (elapsed < 900 || elapsed > 4000){
        console.error('⚠️ Elapsed time outside expected bounds: '+elapsed+'ms');
      } else {
        console.log('✅ Timeout behavior within expected range');
      }
      if(!m.result?.structuredContent){
        console.error('❌ Missing structuredContent in timeout response');
      } else {
        const sc = m.result.structuredContent;
        if(!sc.timedOut){ console.error('❌ structuredContent.timedOut missing/false'); }
        if(sc.configuredTimeoutMs !== 1000){ console.error('⚠️ configuredTimeoutMs unexpected:', sc.configuredTimeoutMs); }
        if(sc.executionTime < 900 || sc.executionTime > 4000){ console.error('⚠️ executionTime out of expected range', sc.executionTime); }
      }
      server.kill();
    }
  } catch(e){ /* ignore parse errors */ } });
});

send(server,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'timeout-test',version:'1.0.0'}}});

// Safety: force exit if no response
setTimeout(()=>{ if(!gotResponse){ console.error('❌ Did not receive timeout response in time'); server.kill(); process.exit(1);} }, 12000);
