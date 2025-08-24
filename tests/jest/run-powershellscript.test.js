const { startServer, waitForReady, collect, rpc } = require('./util');

describe('run-powershellscript alias tool', ()=>{
  test('executes inline script (script param only) and returns output', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershellscript', arguments:{ script:'Write-Output "alias-ok"', confirmed:true }},'alias');
    for(let i=0;i<60;i++){ if(res['alias']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['alias']; expect(msg).toBeTruthy();
    const text = msg.result?.content?.[0]?.text || '';
    expect(text).toMatch(/alias-ok/);
  },8000);

  test('blocked pattern still prevented via alias', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershellscript', arguments:{ script:'Invoke-Expression "Write-Output blocked-alias"' }},'blockedAlias');
    for(let i=0;i<60;i++){ if(res['blockedAlias']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['blockedAlias']; expect(msg).toBeTruthy();
    const txt = msg.result?.content?.[0]?.text || msg.error?.message || '';
    expect(txt.toLowerCase()).toMatch(/blocked/);
  },8000);
});
