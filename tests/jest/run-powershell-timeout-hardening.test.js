const { startServer, waitForReady, collect, rpc } = require('./util');

/**
 * Hardening tests for timeout handling: warnings, cap enforcement, deprecation.
 * NOTE: Does not commit automatically per user request.
 */
describe('run-powershell timeout hardening', ()=>{
  test('emits deprecation warnings and long-timeout warning', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
  // Use ONLY deprecated param to trigger deprecation warning + long timeout (>=60s) without canonical param.
  rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "ok"', aiAgentTimeout:61, confirmed:true }},'hard1');
    for(let i=0;i<80;i++){ if(res['hard1']) break; await new Promise(r=> setTimeout(r,100)); }
    srv.kill();
    const msg = res['hard1']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
  expect(structured.originalTimeoutSeconds).toBe(61);
    const warnings = structured.warnings || [];
    // Should include both deprecation and long-timeout warning substrings
  expect(warnings.some(w=> /deprecated/i.test(w))).toBe(true);
    expect(warnings.some(w=> /long timeout/i.test(w))).toBe(true);
  }, 15000);

  test('rejects timeout above cap', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "x"', aiAgentTimeoutSec: 601, confirmed:true }},'hard2');
    for(let i=0;i<60;i++){ if(res['hard2']) break; await new Promise(r=> setTimeout(r,100)); }
    srv.kill();
    const msg = res['hard2']; expect(msg).toBeTruthy();
    // Expect error path due to McpError on validation
    const errTxt = (msg.error?.message || '').toLowerCase();
    expect(errTxt.includes("exceeds max allowed") || (msg.result?.content?.[0]?.text||"").includes("exceeds max allowed")).toBe(true);
  }, 12000);
});


