const { startServer, waitForReady, collect, rpc } = require('./util');

function sc(msg){ try { return msg.result?.structuredContent || JSON.parse(msg.result?.content?.[0]?.text||'{}'); } catch { return {}; } }

describe('OS and alias classification', ()=>{
  test('dir maps to Get-ChildItem and is SAFE OS_READONLY or INFORMATION_GATHERING/VCS_READONLY', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'dir', confirmed:true }},'dir');
    for(let i=0;i<60;i++){ if(res['dir']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const structured = sc(res['dir']);
    expect(['SAFE'].includes(structured.securityAssessment?.level)).toBe(true);
  },8000);

  test('del /s /q flagged CRITICAL OS_DESTRUCTIVE', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'del /s /q *' }},'del');
    for(let i=0;i<60;i++){ if(res['del']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const txt = res['del'].result?.content?.[0]?.text || res['del'].error?.message || '';
  expect(txt.toLowerCase()).toMatch(/blocked|critical/);
  },8000);

  test('alias rm expands to Remove-Item and is RISKY', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'rm somefile.txt' }},'rm');
    for(let i=0;i<60;i++){ if(res['rm']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const txt = res['rm'].result?.content?.[0]?.text || res['rm'].error?.message || '';
    expect(txt.toLowerCase()).toMatch(/risky pattern|confirmation required/);
  },8000);
});

