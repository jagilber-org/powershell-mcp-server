const { startServer, waitForReady, collect, rpc } = require('./util');

// Helper: wait for response id with polling
async function waitFor(responses, id, ms=15000){
  const end = Date.now()+ms; while(Date.now()<end){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,120)); } return responses[id]; }

describe('run-powershell advanced timeout + watchdog + adaptive', ()=>{
  test('hang command returns JSON-RPC with timeout metadata and no post output', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    const hangCmd = 'Write-Output "pre"; Wait-Event -SourceIdentifier never -Timeout 20; Write-Output "post"';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: hangCmd, confirmed:true, timeout:2 }},'advHang');
    const msg = await waitFor(res,'advHang',30000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {}; // structured content expected
    // Core assertions
    expect(sc.configuredTimeoutMs).toBeGreaterThanOrEqual(2000);
    expect(sc.effectiveTimeoutMs).toBeGreaterThanOrEqual(sc.configuredTimeoutMs);
    expect(sc.timedOut || sc.exitCode === 124).toBe(true);
    // If internal self-destruct occurred, exitCode may be 124
    if(sc.exitCode === 124){ expect(sc.internalSelfDestruct || sc.timedOut).toBe(true); }
    // Ensure we did not get the 'post' marker in stdout preview
    const stdoutPreview = msg.result?.content?.map(c=>c.text||'').join('\n');
    if(stdoutPreview){ expect(stdoutPreview).not.toMatch(/post/); }
  }, 40000);

  test('adaptive extends effective timeout beyond configured', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res=collect(srv);
    // Emit periodic output to simulate activity so adaptive window extends.
    // PowerShell: loop printing every ~0.8s for ~6s total; base timeout 2s so we expect extension.
    const adaptiveCmd = '1..7 | % { Write-Output "tick$_"; Start-Sleep -Milliseconds 800 }; Write-Output "done"';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: adaptiveCmd, confirmed:true, timeout:2, progressAdaptive:true, adaptiveExtendWindowMs:1500, adaptiveExtendStepMs:1500, adaptiveMaxTotalSec:8 }},'advAdaptive');
    const msg = await waitFor(res,'advAdaptive',20000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    expect(sc.success).toBe(true); // should complete successfully
    expect(sc.effectiveTimeoutMs).toBeGreaterThan(sc.configuredTimeoutMs); // extension occurred
    expect(sc.adaptiveExtensions).toBeGreaterThanOrEqual(1);
    // Should include final 'done'
    const stdoutPreview = msg.result?.content?.map(c=>c.text||'').join('\n');
    expect(stdoutPreview).toMatch(/done/);
  }, 25000);

  test('long deprecated timeout parameter surfaces warnings array', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "warn-test"', aiAgentTimeout:65, confirmed:true }},'advWarn');
    const msg = await waitFor(res,'advWarn',12000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    expect(sc.originalTimeoutSeconds).toBe(65);
    const warnings = sc.warnings || [];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w=> /deprecated/i.test(w))).toBe(true);
    expect(warnings.some(w=> /long timeout/i.test(w))).toBe(true);
  }, 15000);
});
