const { spawn } = require('child_process');
const http = require('http');

function getJson(path, port){
  return new Promise((resolve,reject)=>{
    const req = http.request({ hostname:'127.0.0.1', port, path, method:'GET' }, res=>{
      let data=''; res.on('data',d=> data+=d); res.on('end',()=>{ try{ resolve(JSON.parse(data)); }catch(e){ reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

describe('metrics startup fallback', ()=>{
  test('emits fallback event when startup event suppressed', async ()=>{
    const port = 9105;
    const child = spawn('node',['dist/index.js'], { cwd: process.cwd(), env: { ...process.env, METRICS_PORT: String(port), METRICS_SUPPRESS_START_EVENT:'1' } });
    let stdout=''; let stderr='';
    child.stdout.on('data', d=> stdout+=d.toString());
    child.stderr.on('data', d=> stderr+=d.toString());

    // Wait for server listening line
    const start = Date.now();
    while(Date.now()-start < 8000){
      if(/HTTP server listening/.test(stdout) || /HTTP server listening/.test(stderr)) break;
      await new Promise(r=> setTimeout(r,120));
    }

    // Now wait up to 6s for fallback (fires at ~3.5s)
    await new Promise(r=> setTimeout(r, 4000));

    const replay = await getJson('/api/events/replay?since=0&limit=5', port);
    const { events=[] } = replay;
    // Expect at least one SAFE fallback/probe event
    const hasStartup = events.some(e=> /startup/.test(e.id));
    expect(hasStartup).toBe(true);

    child.kill('SIGINT');
  }, 18000);
});
