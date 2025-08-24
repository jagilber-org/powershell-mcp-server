#!/usr/bin/env node
/**
 * Invoke the MCP server's powershell-command tool to list top processes as JSON.
 * Usage: node scripts/mcp-proc-list.mjs
 */
import { spawn } from 'child_process';

const PS_COMMAND = "Get-Process | Sort-Object CPU -Descending | Select-Object -First 25 Name,Id,CPU,PM | ConvertTo-Json -Depth 2";

// Start server (assumes dist build present)
const server = spawn('node', ['dist/index.js'], { stdio: ['pipe','pipe','inherit'] });

let buf = '';
const pending = new Map();
let nextId = 1;
function send(method, params){
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params }) + '\n');
  return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
}

server.stdout.on('data', d => {
  buf += d.toString();
  let idx;
  while((idx = buf.indexOf('\n'))>=0){
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx+1);
    if(!line) continue;
    try {
      const msg = JSON.parse(line);
      if(msg.id && pending.has(msg.id)) {
        const {resolve,reject} = pending.get(msg.id);
        pending.delete(msg.id);
        if(msg.error) reject(msg.error); else resolve(msg.result);
      }
    } catch(e) {
      // ignore non-JSON (stderr is inherited separately)
    }
  }
});

server.on('error', e => { console.error('Server error', e); process.exit(1); });

async function run(){
  // small delay to allow startup
  await new Promise(r=>setTimeout(r,500));
  await send('initialize', { protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'proc-list-script', version:'1.0.0' }});
  // Call tool
  const result = await send('tools/call', { name:'powershell-command', arguments:{ command: PS_COMMAND, confirmed:true }});
  const structured = result.structuredContent || result.content || result;
  if(structured && structured.output) {
    try {
      // output is likely text; print raw
      console.log(structured.output);
    } catch {}
  } else if (Array.isArray(result.content)) {
    const txt = result.content.find(c=>c.type==='text');
    if (txt) console.log(txt.text);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  server.kill();
}

run().catch(err => { console.error('Failure', err); server.kill(); process.exit(1); });
