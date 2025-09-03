const { startServer, waitForReady, collect, rpc } = require('./util');

async function wait(responses,id,ms=5000){ for(let i=0;i<ms/80;i++){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,80)); } return responses[id]; }

describe('verb baseline classification', ()=>{
  test('Get-Location falls back to verb baseline SAFE when no explicit pattern', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Get-Location' }},'vl1');
    await wait(res,'vl1'); srv.kill();
    const msg = res['vl1']; expect(msg).toBeTruthy(); if(msg.error) throw new Error(msg.error.message);
    const sc = msg.result?.structuredContent?.securityAssessment; expect(sc).toBeTruthy();
    expect(sc.level).toBe('SAFE');
  },8000);

  test('Set-Variable requires confirmation (verb baseline RISKY)', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Set-Variable -Name X -Value 1' }},'sv1');
    await wait(res,'sv1'); srv.kill();
    const msg = res['sv1']; expect(msg).toBeTruthy();
    if(msg.error){ expect(msg.error.message.toLowerCase()).toMatch(/requires confirmed:true/); }
    else { const sc = msg.result?.structuredContent?.securityAssessment; expect(['RISKY','UNKNOWN']).toContain(sc.level); }
  },8000);
});
