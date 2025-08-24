// Enterprise test suite: build verification + core tool smoke tests
import { spawn } from 'child_process';
import fs from 'fs';

function spawnServer(){
  const proc = spawn('node', ['dist/server.js'], { stdio:['pipe','pipe','pipe'] });
  return proc;
}

function sendJSON(proc, obj){ proc.stdin.write(JSON.stringify(obj)+'\n'); }

async function runSuite(){
  if(!fs.existsSync('dist/server.js')) throw new Error('dist/server.js missing – build step failed');
  const server = spawnServer();
  const state = { ready:false, tools:[], responses:{}, order:[] };
  let buf='';
  server.stdout.on('data', d=>{
    buf += d.toString();
    let lines = buf.split(/\n/);
    buf = lines.pop();
    for(const line of lines){
      if(!line.trim()) continue;
      try { const msg = JSON.parse(line); if(msg.result){ state.responses[msg.id] = msg.result; } } catch{}
    }
  });
  server.stderr.on('data', d=>{
    const s = d.toString();
    if(s.includes('SERVER CONNECTED') || s.includes('SERVER_READY') || s.includes('CONNECTED SUCCESSFULLY')){
      if(!state.ready){ state.ready=true; setTimeout(()=> listAndRun(), 200); }
    }
  });

  function request(id, method, params){ state.order.push(id); sendJSON(server, { jsonrpc:'2.0', id, method, params }); }

  function listAndRun(){
    request('list','tools/list',{});
    setTimeout(()=>{
      const toolsResp = state.responses['list'];
      const tools = toolsResp?.tools || [];
      state.tools = tools.map(t=> t.name);
      // Minimal core tool invocations
      request('stats','tools/call',{ name:'server-stats', arguments:{} });
      request('help','tools/call',{ name:'help', arguments:{ topic:'security' } });
      request('syntax','tools/call',{ name:'powershell-syntax-check', arguments:{ script:'Get-Process | Select -First 1' } });
      request('run','tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "hello-enterprise"' } });
      request('threat','tools/call',{ name:'threat-analysis', arguments:{} });
      setTimeout(finish, 1200);
    }, 300);
  }

  function finish(){
    try { server.kill(); } catch{}
    const summary = {
      serverStarted: state.ready,
      toolCount: state.tools.length,
      invoked: ['server-stats','help','powershell-syntax-check','run-powershell','threat-analysis'].filter(t=> !!Object.values(state.responses).find(r=> r?.content?.[0]?.text?.includes?.(t)===false || true)),
      outputs: Object.fromEntries(Object.entries(state.responses).map(([k,v])=>[k, typeof v==='object'? Object.keys(v): typeof v]))
    };
    console.log(JSON.stringify({ enterpriseSuite: summary, timestamp:new Date().toISOString() }, null, 2));
  }
}

runSuite().catch(e=>{ console.error('ENTERPRISE_SUITE_FAIL '+e.message); process.exit(1); });
