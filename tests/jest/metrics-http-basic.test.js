// Basic integration test for metrics HTTP server via spawned process
// Spawns built dist/index.js, waits for metrics server to listen, emits synthetic event
// through debug endpoint, then verifies replay + metrics endpoints respond.

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

jest.setTimeout(25000);

function fetchJson(url){
  return new Promise((resolve, reject)=>{
    const req = http.get(url, res=>{
      let data='';
      res.on('data', d=> data+=d.toString());
      res.on('end', ()=>{ try { resolve(JSON.parse(data)); } catch(e){ reject(e); } });
    });
    req.on('error', reject);
  });
}

describe('metrics http server basic', () => {
  test('synthetic event visible via replay endpoint', async () => {
    // Ensure build exists
    try { fs.statSync(path.join(__dirname,'../../dist/index.js')); } catch { require('child_process').execSync('npm run build:only',{stdio:'inherit'}); }
    const PORT = 9195 + Math.floor(Math.random()*50);
    const child = spawn('node',['dist/index.js'], { cwd: path.join(__dirname,'../..'), env: { ...process.env, METRICS_PORT: String(PORT), METRICS_DEBUG:'true' }});
    let started=false; let logs='';
    child.stderr.on('data', d=>{ const s=d.toString(); logs+=s; if(/HTTP server listening/.test(s)) started=true; });
    child.stdout.on('data', d=>{ /* ignore */ });
    const deadline = Date.now()+8000;
    while(!started){ if(Date.now()>deadline){ try{child.kill();}catch{} console.error('Logs:\n'+logs); throw new Error('metrics server did not start'); } await new Promise(r=> setTimeout(r,100)); }
    // Emit synthetic event via debug endpoint
    await fetchJson(`http://127.0.0.1:${PORT}/api/debug/emit?debug=true&level=SAFE&durationMs=5`);
    // Allow publish
    await new Promise(r=> setTimeout(r,120));
    const replay = await fetchJson(`http://127.0.0.1:${PORT}/api/events/replay?since=0&limit=10`);
    expect(Array.isArray(replay.events)).toBe(true);
    const synthetic = replay.events.find(e=> /synthetic/.test(e.id));
    expect(synthetic).toBeTruthy();
    const metricsSnap = await fetchJson(`http://127.0.0.1:${PORT}/api/metrics`);
    expect(metricsSnap).toHaveProperty('totalCommands');
    try{ child.kill(); }catch{}
  });
});
