const { startServer, waitForReady, collect, rpc } = require('./util');
const fs = require('fs');
const path = require('path');

describe('run-powershell with workingDirectory and timeout enforcement', () => {
  test('executes in provided sandbox directory and respects short timeout', async () => {
    const sandbox = path.join(process.cwd(), 'sandbox-test-wd');
    try { fs.mkdirSync(sandbox, { recursive: true }); } catch {}
    // Create a file to list
    const marker = path.join(sandbox, 'marker.txt');
    fs.writeFileSync(marker, 'hello');

    const srv = startServer();
    await waitForReady(srv, 6000);
    const res = collect(srv);

    // Command: output current directory + list marker; sleep past timeout to ensure cut if timeout too small
    const cmd = 'Write-Output "PWD=$(Get-Location)"; Get-ChildItem -Name; Start-Sleep -Seconds 3; Write-Output "AFTER"';
    // Use timeout 1s so AFTER should not appear
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: cmd, confirmed:true, workingDirectory: sandbox, timeout:1 }},'wdTimeout');

    // Wait up to 8s for response (timeout path should trigger earlier)
    const end = Date.now()+8000; let msg; while(Date.now()<end){ if(res['wdTimeout']) { msg = res['wdTimeout']; break; } await new Promise(r=> setTimeout(r,100)); }

    srv.kill();
    expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    // Should have flagged timeout or internal self-destruct, not success
    expect(sc.success).toBe(false);
    expect(sc.timedOut || sc.exitCode === 124).toBe(true);
    // Working directory should be canonical sandbox path
    expect(sc.workingDirectory.replace(/\\/g,'/')).toContain('sandbox-test-wd');
    const preview = msg.result?.content?.map(c=>c.text||'').join('\n') || '';
    // Should show PWD=... and marker.txt listing
    expect(preview).toMatch(/PWD=/);
    expect(preview).toMatch(/marker.txt/);
    // AFTER should not appear due to timeout
    expect(preview).not.toMatch(/AFTER/);
  }, 15000);
});
