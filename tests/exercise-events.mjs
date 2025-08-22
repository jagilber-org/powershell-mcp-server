#!/usr/bin/env node
/**
 * Exercise the PowerShell MCP server and generate real events for the dashboard.
 * Starts its own server (port 9090 unless occupied -> auto-increment) then issues several tool calls.
 */
import { spawn } from 'child_process';
import readline from 'readline';

const SERVER_ARGS = ['dist/server.js'];
process.env.METRICS_PORT = process.env.METRICS_PORT || '9090';

console.log('👉 Launching server with METRICS_PORT=' + process.env.METRICS_PORT);
const server = spawn('node', SERVER_ARGS, { stdio: ['pipe','pipe','pipe'] });

server.stderr.on('data', d=> process.stderr.write(d));

const rl = readline.createInterface({ input: server.stdout });

await new Promise(resolve => setTimeout(resolve, 800));

function send(obj){
  server.stdin.write(JSON.stringify(obj)+'\n');
}

let id = 1;
function nextId(){ return id++; }

// Initialize
send({ jsonrpc:'2.0', id:nextId(), method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'event-exerciser', version:'1.0.0' }}});

// List tools
setTimeout(()=> send({ jsonrpc:'2.0', id:nextId(), method:'tools/list', params:{} }), 600);

// Sequence of commands with variety of security levels
const sequence = [
  { c:'Get-Date' },
  { c:'Get-Process | Select-Object -First 2' },
  { c:'Remove-Item ./nonexistent_file.txt', confirmed:true },
  { c:'Write-Output "Metrics Event Test"' },
  { c:'Get-ChildItem . | Select-Object -First 1' }
];

sequence.forEach((item, idx) => {
  setTimeout(()=> {
    send({ jsonrpc:'2.0', id:nextId(), method:'tools/call', params:{ name:'powershell-command', arguments:{ command:item.c, confirmed:item.confirmed }}});
  }, 1200 + idx*900);
});

// Fetch server-stats at end
setTimeout(()=> {
  send({ jsonrpc:'2.0', id:nextId(), method:'tools/call', params:{ name:'server-stats', arguments:{} }});
}, 1200 + sequence.length*900 + 1200);

// Graceful shutdown after events flushed
setTimeout(()=> {
  console.log('\n✅ Exercise complete. Leave server running for manual inspection (Ctrl+C to stop).');
}, 1200 + sequence.length*900 + 3000);
