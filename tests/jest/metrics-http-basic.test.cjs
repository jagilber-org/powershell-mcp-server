// Basic integration test for metrics HTTP server publish + replay endpoints
// Ensures dashboard plumbing works (publishExecution -> replay buffer -> /api/events/replay JSON)

const http = require('http');

jest.setTimeout(20000);

function fetchJson(url){
  return new Promise((resolve, reject)=>{
    const req = http.get(url, res=>{
      let data='';
      res.on('data', d=> data+=d.toString());
      res.on('end', ()=>{
        try { resolve(JSON.parse(data)); } catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
  });
}

describe('metrics http server basic', () => {
  test('publishes execution event and is retrievable via replay endpoint', async () => {
    // Import after jest env ready
    const { metricsHttpServer } = require('../../src/metrics/httpServer.ts');
    // Start (idempotent)
    metricsHttpServer.start();
    // Wait until started (poll)
    const startDeadline = Date.now()+5000;
    while(!metricsHttpServer.isStarted()){
      if(Date.now()>startDeadline) throw new Error('metrics server failed to start');
      await new Promise(r=> setTimeout(r,75));
    }
    const port = metricsHttpServer.getPort();
    // Publish synthetic event
    const ev = { id:`jest-${Date.now()}`, level:'SAFE', durationMs:3, blocked:false, truncated:false, timestamp: new Date().toISOString(), preview:'jest-metrics-test', success:true, exitCode:0, toolName:'jest-test' };
    metricsHttpServer.publishExecution(ev);
    // Allow event loop to process
    await new Promise(r=> setTimeout(r,120));
    const replay = await fetchJson(`http://127.0.0.1:${port}/api/events/replay?since=0&limit=25`);
    expect(Array.isArray(replay.events)).toBe(true);
    const found = replay.events.some(e=> e.id === ev.id);
    if(!found){
      console.error('Replay events:', replay.events);
    }
    expect(found).toBe(true);
    // Metrics endpoint should respond 200 and include totalCommands (may be 0 if registry not updated here)
    const metricsSnap = await fetchJson(`http://127.0.0.1:${port}/api/metrics`);
    expect(metricsSnap).toHaveProperty('totalCommands');
  });
});
