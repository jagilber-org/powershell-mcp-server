// Cross-server comparison test referencing external repo C:\\github\\jagilber\\obfuscate-mcp-server
// Assumptions:
// 1. External repo has been built already (dist/server.js present) OR will be built on demand with `npm run build`.
// 2. Entry point: dist/server.js (adjust via OBFS_MCP_ENTRY env var if different).
// This test is OPTIONAL; it auto-skips if path missing.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const externalRoot = process.env.OBFS_MCP_ROOT || 'C:/github/jagilber/obfuscate-mcp-server';
const externalEntry = process.env.OBFS_MCP_ENTRY || path.join(externalRoot, 'dist', 'server.js');

function exists(p){ try { return fs.existsSync(p); } catch { return false; } }

if(!exists(externalRoot)){
  console.log(JSON.stringify({ skipped:true, reason:`External repo path not found: ${externalRoot}` }, null, 2));
  process.exit(0);
}

if(!exists(externalEntry)){
  console.error(`[INFO] External entry not found: ${externalEntry}. Attempting build...`);
  if(exists(path.join(externalRoot,'package.json'))){
    await new Promise((resolve,reject)=>{
      const b = spawn(process.platform==='win32'? 'npm.cmd':'npm', ['run','build'], { cwd: externalRoot });
      b.stdout.on('data',d=>process.stderr.write('[EXT BUILD STDOUT] '+d));
      b.stderr.on('data',d=>process.stderr.write('[EXT BUILD STDERR] '+d));
      b.on('close', code=> code===0? resolve(): reject(new Error('External build failed')));
    }).catch(e=>{ console.log(JSON.stringify({ skipped:true, reason:'External build failed '+e.message })); process.exit(0); });
  }
}

if(!exists(externalEntry)){
  console.log(JSON.stringify({ skipped:true, reason:`External entry still missing: ${externalEntry}` }));
  process.exit(0);
}

function startServer(cmd, args, label){
  const proc = spawn(cmd, args, { stdio:['pipe','pipe','pipe'] });
  const state = { stderr:'', stdout:'', tools:null };
  proc.stderr.on('data', d=>{
    const s = d.toString(); state.stderr += s;
    if(/SERVER READY|SERVER CONNECTED|MCP Server/i.test(s) && !state.requested){
      state.requested = true;
      proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'tools/list' })+'\n');
    }
  });
  proc.stdout.on('data', d=>{
    state.stdout += d.toString();
    // naive parse lines
    d.toString().split(/\n/).forEach(line=>{
      try { const msg = JSON.parse(line); if(msg.result && msg.result.tools){ state.tools = msg.result.tools; } } catch {}
    });
  });
  return { proc, state, label };
}

const local = startServer('node',['dist/server.js'],'local');
const external = startServer('node',[externalEntry],'external');

setTimeout(()=>{
  try { local.proc.kill(); } catch {}
  try { external.proc.kill(); } catch {}
  const summary = {
    localTools: local.state.tools? local.state.tools.map(t=>t.name).sort(): null,
    externalTools: external.state.tools? external.state.tools.map(t=>t.name).sort(): null,
    localToolCount: local.state.tools? local.state.tools.length: null,
    externalToolCount: external.state.tools? external.state.tools.length: null,
    diff: []
  };
  if(summary.localTools && summary.externalTools){
    const setExt = new Set(summary.externalTools);
    const setLoc = new Set(summary.localTools);
    summary.diff = [
      ...summary.localTools.filter(n=>!setExt.has(n)).map(n=>({ only:'local', name:n })),
      ...summary.externalTools.filter(n=>!setLoc.has(n)).map(n=>({ only:'external', name:n }))
    ];
  }
  console.log(JSON.stringify({ crossServerCompare: summary }, null, 2));
}, 4000);
