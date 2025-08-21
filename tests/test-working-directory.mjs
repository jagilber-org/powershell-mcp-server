#!/usr/bin/env node
/**
 * Integration test: verify workingDirectory argument executes command in that directory
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distServer = join(__dirname, '..', 'dist', 'server.js');
const authKey = 'testkey';

function makeTempWorkspace() {
  const base = mkdtempSync(join(os.tmpdir(), 'mcp-wd-test-'));
  // create marker file unique content
  const markerContent = `marker-${Date.now()}`;
  writeFileSync(join(base, 'marker.txt'), markerContent, 'utf8');
  return { base, markerContent };
}

const { base: workingDir, markerContent } = makeTempWorkspace();

console.log('🧪 Working Directory Test');
console.log('Server:', distServer);
console.log('WorkingDir:', workingDir);

const server = spawn('node', [distServer, '--key', authKey], { stdio: ['pipe','pipe','pipe'] });
let requestId = 1;
let received = [];

server.stderr.on('data', d => process.stderr.write(d));
server.stdout.on('data', d => {
  const text = d.toString();
  // server can emit multiple json lines
  text.split(/\r?\n/).filter(l=>l.trim()).forEach(line => {
    try { received.push(JSON.parse(line)); } catch {}
  });
});

function send(method, params={}) {
  const msg = { jsonrpc:'2.0', id:requestId++, method, params };
  server.stdin.write(JSON.stringify(msg)+'\n');
}

function wait(ms){return new Promise(r=>setTimeout(r,ms));}

(async() => {
  // initialize
  send('initialize', { protocolVersion:'2024-11-05', capabilities:{ tools:{} }, clientInfo:{ name:'wd-test', version:'1.0.0'} });
  await wait(500);
  // call powershell-command with workingDirectory to read marker
  send('tools/call', { name:'powershell-command', arguments:{ authKey, command:'Get-Content ./marker.txt', workingDirectory: workingDir, confirmed:true }});
  await wait(1500);
  // evaluate
  const commandResponses = received.filter(r=>r.result && r.result.content);
  const contents = commandResponses.map(r=> r.result.content.map(c=>c.text || '').join('\n')).join('\n');
  const success = contents.includes(markerContent);
  if(!success){
    console.error('❌ Did not find marker content in responses');
    console.error('Collected content:', contents);
    process.exitCode = 1;
  } else {
    console.log('✅ Working directory honored; marker content found');
  }
  server.kill();
  // cleanup temp dir
  try { rmSync(workingDir, { recursive:true, force:true }); } catch {}
})();
