const { startServer, waitForReady, collect, rpc } = require('./util');

async function wait(responses,id,ms=4000){ for(let i=0;i<ms/80;i++){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,80)); } return responses[id]; }

describe('Get-* safe classification baseline', ()=>{
  test('Get-Date classified SAFE and does not require confirmation', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Get-Date', timeoutSeconds:4 }},'g1');
    await wait(res,'g1'); srv.kill();
    const msg = res['g1']; expect(msg).toBeTruthy();
    if(msg.error){ throw new Error('Unexpected error '+msg.error.message); }
    const sc = msg.result?.structuredContent?.securityAssessment; expect(sc).toBeTruthy();
    expect(sc.level).toBe('SAFE');
    expect(sc.requiresPrompt).toBe(false);
  },8000);

  test('Stop-Service without confirmation requires confirmed:true (RISKY)', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Stop-Service -Name Spooler' }},'svc1');
    await wait(res,'svc1'); srv.kill();
    const msg = res['svc1']; expect(msg).toBeTruthy();
    if(msg.error){ expect(msg.error.message.toLowerCase()).toMatch(/requires confirmed:true/); }
    else {
      const sc = msg.result?.structuredContent?.securityAssessment; expect(['RISKY','CRITICAL','UNKNOWN']).toContain(sc.level);
    }
  },8000);
});
