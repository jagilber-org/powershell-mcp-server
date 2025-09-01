const { startServer, waitForReady, collect, rpc, fetchMetrics } = require('./util');

async function wait(responses,id,ms=4000){ for(let i=0;i<ms/60;i++){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,60)); } return responses[id]; }

describe('metrics minimum 1ms duration enforcement', ()=>{
  test('very fast commands still produce avgDurationMs >= 1', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    // fire several trivial echo commands
    for(let i=0;i<4;i++){
  rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "hi'+i+'"', confirmed:true, timeoutSeconds:5 }},'c'+i);
      await wait(res,'c'+i,3000);
    }
    // give metrics publisher a moment
    await new Promise(r=> setTimeout(r,250));
    const metrics = await fetchMetrics().catch(()=>null);
    srv.kill();
    expect(metrics).toBeTruthy();
    // Ensure durations collected and non-zero
    expect(metrics.averageDurationMs).toBeGreaterThanOrEqual(1);
    expect(metrics.p95DurationMs).toBeGreaterThanOrEqual(metrics.averageDurationMs); // p95 should be >= avg
  }, 12000);
});
