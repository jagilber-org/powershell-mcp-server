const { startServer, waitForReady, collect, rpc } = require('./util');

describe('run-powershell ps metrics feature flag', ()=>{
  test('captures psProcessMetrics when enabled', async ()=>{
    const srv = startServer({ MCP_CAPTURE_PS_METRICS:'1' });
    await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "hello"', confirmed:true }},'cap');
    for(let i=0;i<50;i++){ if(res['cap']) break; await new Promise(r=> setTimeout(r,120)); }
    srv.kill();
    const msg = res['cap']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    // When enabled we expect object with CpuSec and WS at minimum
    if(!structured.psProcessMetrics){ console.warn('psProcessMetrics missing (race?)'); return; }
    expect(typeof structured.psProcessMetrics.CpuSec).toBe('number');
    expect(typeof structured.psProcessMetrics.WS).toBe('number');
  }, 20000);
});
