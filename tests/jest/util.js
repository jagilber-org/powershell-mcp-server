const { spawn } = require('child_process');

function startServer() {
  const proc = spawn(process.execPath, ['--expose-gc','dist/server.js'], { stdio:['pipe','pipe','pipe'] });
  return proc;
}

function waitForReady(proc, timeoutMs=3000){
  return new Promise((resolve, reject)=>{
    const timer = setTimeout(()=> reject(new Error('Server start timeout')), timeoutMs);
    proc.stderr.on('data', d=> { if(d.toString().includes('SERVER CONNECTED')){ clearTimeout(timer); resolve(); } });
    proc.on('exit', code=>{ clearTimeout(timer); reject(new Error('Server exited early '+code)); });
  });
}

function collect(proc){
  const responses={}; let buf='';
  proc.stdout.on('data', d=> {
    buf += d.toString();
    const lines = buf.split(/\n/); buf = lines.pop();
    for(const line of lines){
      if(!line.trim()) continue; try { const msg = JSON.parse(line); if(msg.id) responses[msg.id]=msg; } catch{}
    }
  });
  return responses;
}

function rpc(proc, method, params, id){ proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params })+'\n'); }

async function request(proc, responses, method, params, id, waitMs=1000){
  rpc(proc, method, params, id);
  const end = Date.now()+waitMs;
  while(Date.now()<end){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,50)); }
  return responses[id];
}

module.exports = { startServer, waitForReady, collect, rpc, request };
