const { spawn } = require('child_process');

function startServer(envOverrides) {
  const env = { ...process.env, ...envOverrides };
  const proc = spawn(process.execPath, ['--expose-gc','dist/server.js'], { stdio:['pipe','pipe','pipe'], env });
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
// Fetch metrics snapshot via HTTP (assumes default port 9090)
module.exports.fetchMetrics = async function(port=9090){
  return new Promise((resolve,reject)=>{
    const http = require('http');
    const req = http.get({ host:'127.0.0.1', port, path:'/api/metrics', timeout:1200 }, res=>{
      let data=''; res.on('data',d=> data+=d.toString()); res.on('end',()=>{ try{ resolve(JSON.parse(data)); }catch(e){ reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', ()=>{ req.destroy(new Error('timeout')); });
  });
};
