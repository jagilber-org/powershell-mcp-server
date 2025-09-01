const { startServer, waitForReady, collect, rpc } = require('./util');

function wait(responses,id,ms=6000){ return new Promise(async r=>{ for(let i=0;i<ms/80;i++){ if(responses[id]) break; await new Promise(s=> setTimeout(s,80)); } r(responses[id]); }); }
function sc(msg){ try { return msg.result?.structuredContent || JSON.parse(msg.result?.content?.[0]?.text||'{}'); } catch { return {}; } }

// Tests added in response to production feedback to prevent regressions in classification gaps
// Feedback items mapped:
// 1. Disk formatting commands not classified as dangerous/blocked
// 2. Registry operations not classified as risky
// 3. Service management commands missing classification
// 4. Network operations missing risk classification
// 5. Threat analysis returning empty results when unknowns executed

describe('classification coverage for feedback gaps', () => {
  test('disk formatting blocked (Format-Volume)', async () => {
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Format-Volume -DriveLetter C -FileSystem NTFS' }},'fmt');
    await wait(res,'fmt'); srv.kill();
    const txt = res['fmt'].result?.content?.[0]?.text || '';
    expect(txt.toLowerCase()).toMatch(/blocked|critical/);
  },10000);

  test('registry modification requires confirmed:true', async () => {
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Set-ItemProperty -Path "HKLM:SOFTWARE\\Test" -Name X -Value 1' }},'reg');
    await wait(res,'reg'); srv.kill();
    const err = res['reg'].error?.message || '';
  expect(err.toLowerCase()).toMatch(/requires confirmed:true|registry/);
  },10000);

  test('service management command requires confirmed:true', async () => {
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Stop-Service -Name Spooler' }},'svc');
    await wait(res,'svc'); srv.kill();
    const err = res['svc'].error?.message || '';
  expect(err.toLowerCase()).toMatch(/requires confirmed:true|service/);
  },10000);

  test('network operation requires confirmed:true', async () => {
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
  rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Invoke-WebRequest -Uri "https://example.com"' }},'net');
    await wait(res,'net'); srv.kill();
    const err = res['net'].error?.message || '';
  expect(err.toLowerCase()).toMatch(/requires confirmed:true|network/);
  },10000);

  test('unknown command appears in threat-analysis', async () => {
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Some-Unknown-Cmd -Param X' }},'unk');
    await wait(res,'unk');
    rpc(srv,'tools/call',{ name:'threat-analysis', arguments:{} },'ta');
    await wait(res,'ta'); srv.kill();
    const ta = res['ta'].result?.content?.[0]?.text || '';
    expect(ta).toMatch(/unknown/i);
  },12000);
});
