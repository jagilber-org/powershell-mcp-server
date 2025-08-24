#!/usr/bin/env node
/**
 * Git Commit & Push via MCP Tools (No direct git CLI usage by assistant)
 *
 * Sequence:
 * 1. Start MCP server (dist/index.js)
 * 2. initialize
 * 3. tools/call git-status (porcelain) to decide if commit needed
 * 4. If changes, tools/call git-commit
 * 5. tools/call git-push (attempt setUpstream for new branch)
 * 6. Print structured results
 */
import { spawn } from 'child_process';

const commitMessage = process.argv.slice(2).join(' ') || 'feat(git-tools): add MCP git tools & enforcement docs';
if (commitMessage.length > 200) {
  console.error('Commit message exceeds 200 characters (tool schema limit).');
  process.exit(1);
}

const server = spawn('node', ['dist/index.js'], { stdio: ['pipe','pipe','inherit'] });

let buffer = '';
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  server.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
  });
}

server.stdout.on('data', data => {
  buffer += data.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          reject(Object.assign(new Error(msg.error.message || 'Unknown error'), { data: msg.error.data, code: msg.error.code, method }));
        } else {
          resolve(msg.result);
        }
      }
    } catch (e) {
      console.error('Non-JSON line from server:', line.substring(0, 200));
    }
  }
});

server.on('error', err => {
  console.error('Server process error:', err);
  process.exit(1);
});

async function main() {
  // Allow brief startup delay
  await new Promise(r => setTimeout(r, 800));
  console.log('→ initialize');
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'git-mcp-script', version: '1.0.0' } });
  console.log('✓ initialized');

  console.log('→ list tools');
  const tools = await send('tools/list', {});
  const names = tools.tools?.map(t => t.name) || [];
  if (!names.includes('git-status') || !names.includes('git-commit') || !names.includes('git-push')) {
    console.error('Required git tools not advertised by server:', names);
    process.exit(1);
  }
  console.log('✓ tools present:', names.filter(n => n.startsWith('git-')).join(', '));

  console.log('→ git-status');
  const statusRes = await send('tools/call', { name: 'git-status', arguments: { porcelain: true } });
  const porcelain = statusRes?.structuredContent?.stdout || statusRes?.stdout || '';
  console.log('git-status porcelain output length:', porcelain.trim().length);

  let committed = false; let commitSummary = '';
  if (porcelain.trim().length > 0) {
    console.log('→ git-commit');
    const commitRes = await send('tools/call', { name: 'git-commit', arguments: { message: commitMessage } });
    committed = !!commitRes?.structuredContent?.success;
    commitSummary = commitRes?.structuredContent?.summary || '';
    console.log('✓ commit summary:', commitSummary.substring(0, 120));
  } else {
    console.log('No staged changes; skipping commit');
  }

  console.log('→ git-push');
  let pushRes;
  try {
    pushRes = await send('tools/call', { name: 'git-push', arguments: { setUpstream: true } });
  } catch (e) {
    console.warn('First push attempt failed (possibly already has upstream). Retrying without setUpstream...');
    pushRes = await send('tools/call', { name: 'git-push', arguments: { setUpstream: false } });
  }
  const pushOut = pushRes?.structuredContent?.output || pushRes?.content?.[0]?.text || '';
  console.log('✓ push output (truncated):', pushOut.substring(0, 200));

  // Final status
  const finalStatus = await send('tools/call', { name: 'git-status', arguments: { porcelain: true } });
  const finalPorcelain = finalStatus?.structuredContent?.stdout || finalStatus?.stdout || '';

  console.log('\nRESULTS');
  console.log(JSON.stringify({
    committed,
    commitSummary,
    push: !!pushRes?.structuredContent?.success,
    remainingChanges: finalPorcelain.trim().length,
  }, null, 2));

  server.kill();
}

main().catch(err => {
  console.error('Failure:', err.message, err.data ? JSON.stringify(err.data) : '');
  server.kill();
  process.exit(1);
});
