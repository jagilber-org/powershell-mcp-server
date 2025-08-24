const { startServer, waitForReady, collect, rpc } = require('./util');

function extractStructured(msg){
  try { return msg.result?.structuredContent || JSON.parse(msg.result?.content?.[0]?.text||'{}'); } catch { return {}; }
}

describe('git/gh classification', ()=>{
  test('git status classified SAFE VCS_READONLY', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'git status', confirmed:true }},'safe');
    for(let i=0;i<60;i++){ if(res['safe']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const structured = extractStructured(res['safe']);
    expect(structured.securityAssessment?.level).toBe('SAFE');
    expect(structured.securityAssessment?.category).toBe('VCS_READONLY');
  },8000);

  test('git commit classified RISKY VCS_MUTATION requires confirmation', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'git commit -m "test"' }},'risky');
    for(let i=0;i<60;i++){ if(res['risky']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const txt = res['risky'].result?.content?.[0]?.text || res['risky'].error?.message || '';
    expect(txt.toLowerCase()).toMatch(/confirmation required|risky pattern/);
  },8000);

  test('git push --force blocked as CRITICAL', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'git push --force' }},'blocked');
    for(let i=0;i<60;i++){ if(res['blocked']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const txt = res['blocked'].result?.content?.[0]?.text || res['blocked'].error?.message || '';
    expect(txt.toLowerCase()).toMatch(/blocked/);
  },8000);
});
