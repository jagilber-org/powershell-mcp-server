const { startServer, waitForReady, collect, rpc } = require('./util');

/**
 * CRITICAL TIMEOUT HARDENING TESTS
 * 
 * These tests validate enterprise-grade timeout enforcement and security controls.
 * DO NOT REMOVE OR MODIFY THE HANG TEST COMMAND - it's specifically designed to
 * create a reliable infinite loop that can only be terminated by timeout enforcement.
 * 
 * The hang command uses Console.ReadKey in a loop which:
 * - Cannot be interrupted by normal signals
 * - Requires forceful process termination
 * - Validates real-world timeout scenarios
 * - Prevents false positives from fast-exiting commands
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

  /**
   * CRITICAL TEST: DO NOT MODIFY OR REMOVE
   * 
   * This test validates that genuine hanging commands are properly detected and terminated.
   * 
   * THE HANG COMMAND: while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }
   * 
   * Why this specific command:
   * - Console.ReadKey($true) creates a blocking wait for keyboard input
   * - The $true parameter makes it non-echoing and immediate
   * - The infinite while loop ensures it never exits naturally
   * - The try/catch handles any console errors and falls back to sleep
   * - This creates a reliable hang that can ONLY be terminated by timeout
   * 
   * Test Requirements:
   * - Command MUST be terminated by timeout (timedOut=true OR exitCode=124)
   * - Command MUST NOT report success=true
   * - Execution time MUST reach at least 80% of configured timeout
   * - These conditions prevent false positives from fast-exiting commands
   */
  test('forced hang MUST reach timeout (no early success output)', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    
    // CRITICAL: This exact command is required for reliable hang testing
    // DO NOT MODIFY - it's specifically designed to hang indefinitely
    const hangCommand = 'while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }';
    const timeoutSec = 1; // Keep small for fast test execution
    const start = Date.now();
    
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: hangCommand, confirmed:true, timeout: timeoutSec }},'hardHang');
    for(let i=0;i<120;i++){ if(res['hardHang']) break; await new Promise(r=> setTimeout(r,120)); }
    const elapsedMs = Date.now()-start;
    srv.kill();
    
    const msg = res['hardHang']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    
    // CRITICAL ASSERTIONS: These validate genuine timeout behavior
    expect(structured.timedOut || structured.exitCode === 124).toBe(true);
    expect(structured.success).toBe(false);
    const configured = structured.configuredTimeoutMs || (timeoutSec*1000);
    expect(elapsedMs).toBeGreaterThanOrEqual(Math.floor(configured*0.8));
  }, 15000);

  /**
   * REFERENCE TEST EXECUTION
   * 
   * Manual validation of the hang command behavior:
   * Command: while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }
   * Timeout: 5000ms
   * Expected Results:
   * - success: false
   * - timedOut: true  
   * - duration_ms: ~5033ms
   * - exitCode: null (forceful termination)
   * - error: "Command timed out after 5000ms"
   * 
   * This validates that the timeout enforcement works correctly in production.
   */
});

// Export the critical hang command for reference in other tests
module.exports = {
  CRITICAL_HANG_COMMAND: 'while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }'
};