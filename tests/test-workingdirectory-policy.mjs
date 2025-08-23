#!/usr/bin/env node
/**
 * Test working directory policy enforcement with disallowed path.
 */
import { spawn } from 'child_process';

function send(req, proc) { proc.stdin.write(JSON.stringify(req)+'\n'); }

async function run() {
  console.log('🧪 Testing working directory policy enforcement...');
  const server = spawn('node', ['dist/server.js'], { stdio:['pipe','pipe','pipe'] });
  server.stderr.on('data', d => process.stderr.write(d));
  server.stdout.on('data', d => {
    const line = d.toString().trim();
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 3) {
        console.log('\n🔧 Enforcement enable response received');
        const text = msg?.result?.content?.[0]?.text;
        if (text) { try { const body = JSON.parse(text); console.log('New enforcement state:', body.newState); } catch {} }
      } else if (msg.id === 4) {
        console.log('\n Response for policy test');
        try {
          const text = msg?.result?.content?.[0]?.text;
          if (!text) {
            console.log('No content payload');
          } else {
            const body = JSON.parse(text);
            console.log('Success:', body.success);
            console.log('Error:', body.error);
            console.log('Stderr:', body.stderr);
            if (body.error === 'WORKING_DIRECTORY_POLICY_VIOLATION' && body.success === false) {
              console.log('✅ Policy violation correctly detected');
            } else if (body.success === true && !body.error) {
              console.log('❌ Expected violation but command succeeded');
            } else {
              console.log('❌ Unexpected outcome');
            }
          }
        } catch(e) { console.log('Parse error', e); }
        server.kill();
      }
    } catch {}
  });
  send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'test',version:'1.0.0'} }}, server);
  setTimeout(()=> send({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} }, server), 1000);
  // Enable working directory enforcement first using correct tool name
  setTimeout(()=> {
    send({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'enforce-working-directory', arguments:{ enabled:true } } }, server);
  }, 1800);
  // Then attempt command in disallowed directory to trigger violation
  setTimeout(()=> {
    send({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'powershell-command', arguments:{ command:'Get-ChildItem', workingDirectory:'C:/Windows/System32' } } }, server);
  }, 2600);
}
run();
