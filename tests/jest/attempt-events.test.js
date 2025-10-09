const http = require('http');
const { spawn } = require('child_process');
const { collect, rpc } = require('./util');

function startServerWithStderrCapture(envOverrides){
  const env = { ...process.env, ...envOverrides };
  const proc = spawn(process.execPath, ['--expose-gc','dist/server.js'], { stdio:['pipe','pipe','pipe'], env });
  return proc;
}

function waitForReady(proc, timeoutMs=4000){
  return new Promise((resolve, reject)=>{
    const timer = setTimeout(()=> reject(new Error('Server start timeout')), timeoutMs);
    proc.stderr.on('data', d=> { const s=d.toString(); if(s.includes('SERVER CONNECTED')){ clearTimeout(timer); resolve(); } });
    proc.on('exit', code=>{ clearTimeout(timer); reject(new Error('Server exited early '+code)); });
  });
}

function fetchJson(port, path){
  return new Promise((resolve,reject)=>{
    const req = http.request({ host:'127.0.0.1', port, path, method:'GET' }, res=>{
      let data=''; res.on('data',d=> data+=d); res.on('end',()=>{ try { resolve(JSON.parse(data)); } catch(e){ reject(e); } });
    });
    req.on('error',reject); req.end();
  });
}

describe('attempt event publishing', ()=>{
  let srv;
  afterEach(()=>{ try { srv?.kill(); } catch{} });
  test('blocked + unconfirmed risky produce responses (attempt events exercised)', async ()=>{
    srv = startServerWithStderrCapture({ MCP_CAPTURE_PS_METRICS:'0' });
    await waitForReady(srv);
    const responses = collect(srv);
    // Wait for metrics server to start (poll /api/metrics)
    let metricsPortReady = null; let snapEarly=null;
    const startDeadline = Date.now()+5000;
    while(Date.now()<startDeadline && !metricsPortReady){
      for(let p=9300;p<=9350;p++){
        try { const s = await fetchJson(p,'/api/metrics'); if(s && typeof s.totalCommands==='number'){ metricsPortReady=p; snapEarly=s; break; } } catch{}
      }
      if(!metricsPortReady) await new Promise(r=> setTimeout(r,120));
    }
    // Now issue commands after metrics server confirmed so attempts are captured
    rpc(srv,'tools/call',{ name:'run_powershell', arguments:{ command:'git push --force' }},'blk');
    rpc(srv,'tools/call',{ name:'run_powershell', arguments:{ command:'git commit -m "t"' }},'risky');
    const endResp = Date.now()+4000;
    while(Date.now()<endResp){ if(responses['blk'] && responses['risky']) break; await new Promise(r=> setTimeout(r,80)); }
  expect(responses['blk']).toBeTruthy();
  expect(responses['risky']).toBeTruthy();
  }, 15000);
});
