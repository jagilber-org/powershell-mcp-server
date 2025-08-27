const { startServer, waitForReady, collect, rpc } = require('./util');
async function waitFor(res,id,ms=12000){ const end=Date.now()+ms; while(Date.now()<end){ if(res[id]) return res[id]; await new Promise(r=> setTimeout(r,80)); } return res[id]; }

describe('run-powershell timeout edge cases', ()=>{
  test('zero timeout falls back to default and command completes quickly', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "zero-ok"', confirmed:true, timeoutSeconds:0 }},'zero');
    const msg = await waitFor(res,'zero',6000); srv.kill(); expect(msg).toBeTruthy();
    const text = msg.result?.content?.[0]?.text || ''; expect(text).toMatch(/zero-ok/);
  }, 10000);

  test('high but within cap warns and succeeds', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "hi"', aiAgentTimeoutSec: 590, confirmed:true }},'high');
    const msg = await waitFor(res,'high',8000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {}; expect(sc.originalTimeoutSeconds).toBe(590);
    const warnings = sc.warnings || []; expect(warnings.some(w=> /long timeout/i.test(w))).toBe(true);
  }, 12000);

  test('shell executable recorded', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "shell"', confirmed:true }},'shell');
    const msg = await waitFor(res,'shell',6000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {}; expect(typeof sc.shellExe).toBe('string');
    expect(/pwsh\.exe|powershell\.exe/i.test(sc.shellExe)).toBe(true);
  }, 10000);
});


