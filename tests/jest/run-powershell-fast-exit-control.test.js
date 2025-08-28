const { startServer, waitForReady, collect, rpc } = require('./util');

describe('run-powershell fast-exit control', ()=>{
  test('quick command must not appear as hang/timeout', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    const command = 'Write-Output "fast-exit"';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command, confirmed:true, timeout:5 }},'fast1');
    for(let i=0;i<40;i++){ if(res['fast1']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['fast1']; expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    expect(sc.success).toBe(true);
    expect(sc.timedOut).toBe(false);
    expect(sc.terminationReason).toBe('completed');
    expect((sc.stdout||'').includes('fast-exit')).toBe(true);
  }, 8000);
});