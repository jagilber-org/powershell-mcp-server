const { startServer, waitForReady, collect, rpc } = require('./util');

// Helper: wait for response id with polling
async function waitFor(responses, id, ms=15000){
  const end = Date.now()+ms; while(Date.now()<end){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,120)); } return responses[id]; }

function dumpAdaptive(sc){
  // Provide targeted diagnostics when adaptive test fails
  /* eslint-disable no-console */
  if(!sc) return; console.log('ADAPTIVE DEBUG =>', JSON.stringify({
    success: sc.success,
    exitCode: sc.exitCode,
    timedOut: sc.timedOut,
    terminationReason: sc.terminationReason,
    configuredTimeoutMs: sc.configuredTimeoutMs,
    effectiveTimeoutMs: sc.effectiveTimeoutMs,
    adaptiveExtensions: sc.adaptiveExtensions,
    adaptiveExtended: sc.adaptiveExtended,
    adaptiveMaxTotalMs: sc.adaptiveMaxTotalMs,
    internalTimerMs: sc.internalTimerMs,
    watchdogHardKillTotalMs: sc.watchdogHardKillTotalMs,
    lastActivityDeltaMs: sc.lastActivityDeltaMs,
    stdoutSample: (sc.stdout||'').slice(0,120),
    adaptiveLog: sc.adaptiveLog?.slice(0,20) // cap
  }, null, 2));
}

describe('run-powershell advanced timeout + watchdog + adaptive', ()=>{
  test('hang command returns JSON-RPC with timeout metadata and no post output', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    const hangCmd = 'Write-Output "pre"; Wait-Event -SourceIdentifier never -Timeout 20; Write-Output "post"';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: hangCmd, confirmed:true, timeoutSeconds:2 }},'advHang');
    const msg = await waitFor(res,'advHang',30000); srv.kill(); expect(msg).toBeTruthy();
  const sc = msg.result?.structuredContent || {};
  console.log('ADAPTIVE_SC:', JSON.stringify(sc,null,2)); // structured content expected
    expect(sc.configuredTimeoutMs).toBeGreaterThanOrEqual(2000);
    expect(sc.effectiveTimeoutMs).toBeGreaterThanOrEqual(sc.configuredTimeoutMs);
    expect(sc.timedOut || sc.exitCode === 124).toBe(true);
    if(sc.exitCode === 124){ expect(sc.internalSelfDestruct || sc.timedOut).toBe(true); }
    const stdoutPreview = msg.result?.content?.map(c=>c.text||'').join('\n');
    if(stdoutPreview){ expect(stdoutPreview).not.toMatch(/post/); }
  }, 40000);

  test('adaptive extends effective timeout beyond configured', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res=collect(srv);
    const adaptiveCmd = '1..7 | % { Write-Output "tick$_"; Start-Sleep -Milliseconds 800 }; Write-Output "done"';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: adaptiveCmd, confirmed:true, timeoutSeconds:2, progressAdaptive:true, adaptiveExtendWindowMs:1500, adaptiveExtendStepMs:1500, adaptiveMaxTotalSec:8 }},'advAdaptive');
    const msg = await waitFor(res,'advAdaptive',20000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
  console.log('ADAPTIVE_ADAPTIVE_SC:', JSON.stringify(sc,null,2));
  if(sc.adaptiveLog) console.log('ADAPTIVE_LOG:', JSON.stringify(sc.adaptiveLog,null,2));
  if(!(sc.success && sc.effectiveTimeoutMs > sc.configuredTimeoutMs && sc.adaptiveExtensions >=1)) dumpAdaptive(sc);
    expect(sc.success).toBe(true); // should complete successfully
    expect(sc.effectiveTimeoutMs).toBeGreaterThan(sc.configuredTimeoutMs); // extension occurred
    expect(sc.adaptiveExtensions).toBeGreaterThanOrEqual(1);
    const stdoutPreview = msg.result?.content?.map(c=>c.text||'').join('\n');
    expect(stdoutPreview).toMatch(/done/);
  }, 25000);

  test('long deprecated timeout parameter surfaces warnings array', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "warn-test"', aiAgentTimeoutSeconds:65, confirmed:true }},'advWarn');
    const msg = await waitFor(res,'advWarn',12000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    expect(sc.originalTimeoutSeconds).toBe(65);
    const warnings = sc.warnings || [];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w=> /deprecated/i.test(w))).toBe(true);
    expect(warnings.some(w=> /long timeout/i.test(w))).toBe(true);
  }, 15000);
});
