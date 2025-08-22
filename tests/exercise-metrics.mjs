#!/usr/bin/env node
/**
 * Quick exerciser to generate metrics & SSE events.
 */
import { spawn } from 'child_process';

function send(proc, obj){
  proc.stdin.write(JSON.stringify(obj)+'\n');
}

const server = spawn('node', ['dist/server.js'], { stdio:['pipe','pipe','pipe']});

server.stderr.on('data', d=>process.stderr.write(d));
server.stdout.on('data', d=>{
  const lines = d.toString().trim().split(/\n+/);
  for(const line of lines){
    if(!line) continue;
    try { const msg = JSON.parse(line); console.log('<-', msg.method||msg.id); } catch { console.log('NONJSON', line); }
  }
});

setTimeout(()=>{
  send(server, { jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'metrics-exerciser', version:'1.0.0' }}});
}, 800);

setTimeout(()=>{
  send(server, { jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
}, 1500);

// Execute variety of commands
const cmds = [
  'Get-Date',
  'Get-Process | Select-Object -First 1',
  'Get-ChildItem . | Select-Object -First 2',
  'Remove-Item ./no_such_file.txt',
  'Write-Output "Hello Metrics"'
];

cmds.forEach((c, i)=>{
  setTimeout(()=>{
    send(server, { jsonrpc:'2.0', id:100+i, method:'tools/call', params:{ name:'powershell-command', arguments:{ command:c, confirmed:true }}});
  }, 2200 + i*800);
});

// Fetch server-stats tool at end
setTimeout(()=>{
  send(server, { jsonrpc:'2.0', id:500, method:'tools/call', params:{ name:'server-stats', arguments:{} }});
}, 2200 + cmds.length*800 + 1000);

setTimeout(()=>{
  console.log('Done exercising, leaving server running for a bit...');
}, 2200 + cmds.length*800 + 4000);

// Allow process to continue (manual Ctrl+C to stop), or exit after some time
setTimeout(()=>{ server.kill(); }, 2200 + cmds.length*800 + 15000);
