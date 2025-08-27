const { startServer, waitForReady, collect, rpc } = require('./util');

/**
 * Tests adaptive timeout extension behavior and terminationReason integrity.
 */
describe('run-powershell adaptive timeout + terminationReason integrity', ()=>{
  test('adaptive extension increases effective timeout beyond configured base', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    // Command: produce periodic output to qualify for adaptive extension then exit cleanly after ~3 intervals
    const command = '[int]$i=0; while($i -lt 3){ Write-Output "tick:$i"; Start-Sleep -Milliseconds 900; $i++ }';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command, confirmed:true, timeout:2, adaptiveTimeout:true, adaptiveExtendWindowMs:700, adaptiveExtendStepMs:1500, adaptiveMaxTotalSec:10 }},'adaptive1');
    for(let i=0;i<80;i++){ if(res['adaptive1']) break; await new Promise(r=> setTimeout(r,150)); }
    srv.kill();
    const msg = res['adaptive1']; expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    expect(sc.success).toBe(true);
    expect(sc.timedOut).toBe(false);
    expect(sc.adaptiveExtensions).toBeGreaterThanOrEqual(1);
    expect(sc.effectiveTimeoutMs).toBeGreaterThan(sc.configuredTimeoutMs);
    expect(sc.terminationReason).toBe('completed');
  }, 20000);

  test('timeout terminationReason consistency', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    const hangCommand = 'while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: hangCommand, confirmed:true, timeout:1 }},'adaptiveHang');
    for(let i=0;i<120;i++){ if(res['adaptiveHang']) break; await new Promise(r=> setTimeout(r,120)); }
    srv.kill();
    const msg = res['adaptiveHang']; expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    expect(sc.timedOut || sc.exitCode===124).toBe(true);
    expect(sc.terminationReason).toBe('timeout');
    expect(sc.success).toBe(false);
  }, 15000);
});