const { startServer, waitForReady, collect, request } = require('./util');

function findContent(msg){ return msg?.result?.content?.map(c=>c.text||'').join('\n') || ''; }

describe('classification: registry/network/service/disk', () => {
  let srv; let res;
  beforeAll(async ()=>{ srv=startServer(); await waitForReady(srv); res=collect(srv); });
  afterAll(()=> { try { srv.kill(); } catch{} });

  test('registry modification marked RISKY & requires confirmation', async () => {
    const id='reg1'; await request(srv,res,'tools/call',{ name:'run-powershell', arguments:{ command:'Set-ItemProperty -Path HKLM:SOFTWARE\\Test -Name X -Value 1' } }, id, 2000).catch(e=>e);
    // Expect error due to confirmation requirement
    const msg = res[id];
    expect(msg && msg.error).toBeTruthy();
  }, 8000);

  test('service management marked RISKY', async () => {
    const id='svc1'; await request(srv,res,'tools/call',{ name:'run-powershell', arguments:{ command:'Stop-Service -Name Spooler' } }, id, 2000).catch(e=>e);
    const msg = res[id];
    expect(msg && msg.error).toBeTruthy();
  }, 8000);

  test('network operation marked RISKY', async () => {
    const id='net1'; await request(srv,res,'tools/call',{ name:'run-powershell', arguments:{ command:'Invoke-WebRequest -Uri "https://example.com"' } }, id, 2000).catch(e=>e);
    const msg = res[id];
    expect(msg && msg.error).toBeTruthy();
  }, 8000);

  test('disk format blocked CRITICAL', async () => {
    const id='disk1'; const r= await request(srv,res,'tools/call',{ name:'run-powershell', arguments:{ command:'Format-Volume -DriveLetter C -FileSystem NTFS' } }, id, 2000);
    const text = findContent(r);
    expect(/Blocked/i.test(text)).toBe(true);
  }, 8000);
});
