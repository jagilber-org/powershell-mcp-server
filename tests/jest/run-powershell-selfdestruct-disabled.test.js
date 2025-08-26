const { startServer, waitForReady, collect, rpc } = require('./util');

describe('run-powershell self-destruct disabled', ()=>{
  test('does not use exit 124 when MCP_DISABLE_SELF_DESTRUCT=1', async ()=>{
    const srv = startServer({ MCP_DISABLE_SELF_DESTRUCT: '1' }); await waitForReady(srv); const res = collect(srv);
    // With self-destruct disabled, a short timeout still enforces external timeout but code 124 should not appear; may be null or non-124 with timedOut=true
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Start-Sleep -Seconds 3; Write-Output "done"', confirmed:true, timeout:1 }},'nosd');
    for(let i=0;i<140;i++){ if(res['nosd']) break; await new Promise(r=> setTimeout(r,120)); }
    srv.kill();
    const msg = res['nosd']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    if(structured.exitCode === 124){ console.warn('Self-destruct still triggered unexpectedly'); }
    expect(structured.exitCode === 124).toBe(false);
    expect(structured.timedOut || structured.exitCode !== 0).toBe(true);
  }, 25000);
});