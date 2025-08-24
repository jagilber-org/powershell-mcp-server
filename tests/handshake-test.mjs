// Simple MCP handshake test: spawn server via dist/index.js and issue list_tools request over stdio.
import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], { stdio: ['pipe','pipe','pipe'] });

let stdoutBuf = '';
let stderrBuf = '';
server.stdout.on('data', d => {
  stdoutBuf += d.toString();
  if (d.toString().includes('"tools"')) {
    console.log('STDOUT chunk:', d.toString());
  }
  if (stdoutBuf.length > 8000) stdoutBuf = stdoutBuf.slice(-8000);
});
server.stderr.on('data', d => {
  const s = d.toString();
  stderrBuf += s;
  console.error('[STDERR]', s.trim());
  if (s.includes('SERVER CONNECTED')) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n';
    server.stdin.write(msg);
  }
});

server.on('exit', code => {
  console.log('Server exited with code', code);
  console.log('Captured STDOUT (tail):', stdoutBuf.slice(-1000));
  console.log('Captured STDERR (tail):', stderrBuf.slice(-1000));
});

setTimeout(()=>{
  console.log('Timeout reached, current STDOUT tail:', stdoutBuf.slice(-1000));
  console.log('Timeout reached, current STDERR tail:', stderrBuf.slice(-1000));
  try { server.kill(); } catch {}
}, 12000);
