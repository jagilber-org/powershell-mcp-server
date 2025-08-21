#!/usr/bin/env node
/**
 * Test output truncation logic by generating large output.
 */
import { spawn } from 'child_process';

function send(req, proc) {
  proc.stdin.write(JSON.stringify(req) + '\n');
}

async function run() {
  console.log('🧪 Testing output truncation...');
  const server = spawn('node', ['dist/server.js'], { stdio: ['pipe','pipe','pipe'] });

  server.stderr.on('data', d => process.stderr.write(d));
  server.stdout.on('data', d => {
    const line = d.toString().trim();
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2) {
        console.log('\n📩 Command Response Received');
        const content = JSON.parse(msg.result.content[0].text);
        console.log('Length bytes:', Buffer.byteLength((content.stdout||'') + (content.stderr||'')));
        console.log('Truncated flag in error?', content.error);
        if (content.stdout.includes('<TRUNCATED>') || (content.error && content.error.includes('TRUNCATED'))) {
          console.log('✅ Truncation confirmed');
        } else {
          console.log('❌ Truncation not detected');
        }
        server.kill();
      }
    } catch {}
  });

  // initialize
  send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'test',version:'1.0.0'} }}, server);

  // list tools
  setTimeout(()=> send({ jsonrpc:'2.0', id:99, method:'tools/list', params:{} }, server), 1000);

  // generate large output (5000 lines) to trigger truncation
  setTimeout(()=> {
    const ps = '1..5000 | ForEach-Object { \"LINE: $_\" }';
    send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'powershell-command', arguments:{ command: ps } } }, server);
  }, 2000);
}
run();
