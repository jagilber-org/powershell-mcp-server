#!/usr/bin/env node
/**
 * Extensive read/get command exerciser for PowerShell MCP server.
 * Starts a fresh server (replacing any existing one you were running manually)
 * then issues a burst of SAFE read-oriented commands to populate metrics/events.
 */
import { spawn, execSync } from 'child_process';
import readline from 'readline';

// Attempt to terminate any previous background node server (best-effort)
try {
  if (process.env.OLD_SERVER_PID) {
    execSync(`taskkill /PID ${process.env.OLD_SERVER_PID} /F`);
  }
} catch {}

process.env.METRICS_PORT = process.env.METRICS_PORT || '9091';
console.log('\n▶ Launching new server on METRICS_PORT=' + process.env.METRICS_PORT + ' ...');
const server = spawn('node', ['dist/server.js'], { stdio: ['pipe','pipe','pipe'] });

server.stderr.on('data', d => process.stderr.write(d));

const rl = readline.createInterface({ input: server.stdout });
rl.on('line', line => {
  // Uncomment to debug server stdout lines
  // console.log('[SERVER]', line);
});

function send(obj){ server.stdin.write(JSON.stringify(obj)+'\n'); }
let id=1; const nextId=()=>id++;

// Wait a touch for startup
await new Promise(r=>setTimeout(r,700));

send({ jsonrpc:'2.0', id:nextId(), method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'read-get-exerciser', version:'1.0.0' }}});
setTimeout(()=> send({ jsonrpc:'2.0', id:nextId(), method:'tools/list', params:{} }), 400);

// Collection of SAFE/READ commands
const commands = [
  'Get-Date',
  'Get-Location',
  'Get-ChildItem -Name | Select-Object -First 5',
  'Get-Process | Select-Object -First 5 Name,Id,CPU',
  'Get-Service | Select-Object -First 5 Status,Name',
  'Get-Module | Select-Object -First 5 Name,Version',
  'Get-Command Get-* | Select-Object -First 10 Name',
  'Get-ChildItem Env: | Select-Object -First 10 Name,Value',
  'Get-PSDrive | Select-Object -First 5 Name,Free,Used',
  'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,LastBootUpTime',
  'Get-Item .',
  'Get-Content ./README.md -TotalCount 3',
  'Get-ChildItem . -File | Select-Object -First 3 Name,Length',
  'Get-ChildItem . -Directory | Select-Object -First 3 Name',
  'Get-Process | Sort-Object CPU -Descending | Select-Object -First 3 Name,Id,CPU',
  'Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory',
  'Get-CimInstance Win32_LogicalDisk | Select-Object -First 3 DeviceID,Size,FreeSpace',
  'Get-Culture',
  'Get-TimeZone',
  'Get-Random',
  'Get-ChildItem ./src -Recurse -File | Select-Object -First 5 FullName,Length',
  'Get-ChildItem ./tests -Recurse -File | Select-Object -First 5 FullName,Length',
  'Get-Process powershell | Select-Object -First 1 Name,Id,CPU',
  'Get-ChildItem HKLM:Software | Select-Object -First 5 PSChildName',
  // Duplicate a few to increase volume
  'Get-Date', 'Get-Date', 'Get-Date', 'Get-Location'
];

commands.forEach((c, idx) => {
  setTimeout(()=>{
    send({ jsonrpc:'2.0', id:nextId(), method:'tools/call', params:{ name:'powershell-command', arguments:{ command:c }}});
  }, 900 + idx*220); // stagger
});

// Periodic stats queries
for (let i=0;i<5;i++) {
  setTimeout(()=>{
    send({ jsonrpc:'2.0', id:nextId(), method:'tools/call', params:{ name:'server-stats', arguments:{} }});
  }, 1200 + commands.length*220 + i*1500);
}

setTimeout(()=>{
  console.log('\n✅ Read/Get exercise complete. Dashboard should be populated. (Server left running)');
}, 1200 + commands.length*220 + 5*1500 + 1500);
