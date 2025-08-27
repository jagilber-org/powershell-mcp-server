const { startServer, waitForReady, collect, rpc } = require('./util');

/**
 * Hardening tests for timeout handling: warnings, cap enforcement, deprecation, forced hang.
 */
describe('run-powershell timeout hardening', ()=>{
  test('emits deprecation warnings and long-timeout warning', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "ok"', aiAgentTimeout:61, confirmed:true }},'hard1');
    for(let i=0;i<80;i++){ if(res['hard1']) break; await new Promise(r=> setTimeout(r,100)); }
    srv.kill();
    const msg = res['hard1']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    expect(structured.originalTimeoutSeconds).toBe(61);
    const warnings = structured.warnings || [];
    expect(warnings.some(w=> /deprecated/i.test(w))).toBe(true);
    expect(warnings.some(w=> /long timeout/i.test(w))).toBe(true);
  }, 15000);

  test('rejects timeout above cap', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "x"', aiAgentTimeoutSec: 601, confirmed:true }},'hard2');
    for(let i=0;i<60;i++){ if(res['hard2']) break; await new Promise(r=> setTimeout(r,100)); }
    srv.kill();
    const msg = res['hard2']; expect(msg).toBeTruthy();
    const errTxt = (msg.error?.message || '').toLowerCase();
    expect(errTxt.includes("exceeds max allowed") || (msg.result?.content?.[0]?.text||"").includes("exceeds max allowed")).toBe(true);
  }, 12000);

  test('forced hang MUST reach timeout (no early success output)', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    const hangCommand = 'while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }';
    const timeoutSec = 1; // keep very small so a genuine hang triggers quickly
    const start = Date.now();
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: hangCommand, confirmed:true, timeout: timeoutSec }},'hardHang');
    for(let i=0;i<120;i++){ if(res['hardHang']) break; await new Promise(r=> setTimeout(r,120)); }
    const elapsedMs = Date.now()-start;
    srv.kill();
    const msg = res['hardHang']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    // Must have timedOut or internal self destruct exit 124
    expect(structured.timedOut || structured.exitCode === 124).toBe(true);
    // Should not report success and must not exit too early (< 80% of configured timeout)
    expect(structured.success).toBe(false);
    const configured = structured.configuredTimeoutMs || (timeoutSec*1000);
    expect(elapsedMs).toBeGreaterThanOrEqual(Math.floor(configured*0.8));
  }, 15000);
});