const { startServer, waitForReady, collect, rpc } = require('./util');

/**
 * Hard hang test using provided ReadKey loop that should require forced termination.
 * Command: pwsh -NoLogo -NoProfile -Command "while(`$true) { try { [System.Console]::ReadKey(`$true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }"
 */
describe('run-powershell hard hang termination', ()=>{
  test('forces timeout and (kill escalation OR internal self-destruct) on ReadKey loop', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    const hangCmd = 'pwsh -NoLogo -NoProfile -Command "while(`$true) { try { [System.Console]::ReadKey(`$true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }"';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: hangCmd, confirmed:true, aiAgentTimeoutSec:2 }},'hardHang');
    // Allow up to ~20s since watchdog + grace can extend beyond requested timeout
    for(let i=0;i<120;i++){ if(res['hardHang']) break; await new Promise(r=> setTimeout(r,160)); }
    srv.kill();
    const msg = res['hardHang']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    // Must have timed out or internal self-destruct
    expect(structured.timedOut || structured.exitCode === 124).toBe(true);
    // Expect some hard termination signal: kill escalated OR watchdog OR internal self-destruct
    expect(!!structured.killEscalated || !!structured.watchdogTriggered || structured.exitCode === 124).toBe(true);
    // Ensure duration respected (should not exceed ~25s for 2s timeout + overhead)
    if(typeof structured.duration_ms === 'number'){
      expect(structured.duration_ms).toBeLessThan(25000);
    }
  }, 40000);
});
