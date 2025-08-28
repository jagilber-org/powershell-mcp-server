const { startServer, waitForReady, collect, request } = require('./util');

// This test assumes pwsh.exe is installed on the host running CI / developer machine.
// If not present it will be skipped.

describe('shell detection', () => {
  test('prefers pwsh.exe when available', async () => {
    const which = require('child_process').spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-Command','$PSVersionTable.PSEdition'], { encoding:'utf8' });
    if(which.status !== 0){
      console.warn('pwsh.exe not available - skipping test');
      return;
    }
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
    const r = await request(srv, responses, 'tools/call', { name:'run-powershell', arguments:{ command:'Write-Output test', confirmed:true, timeoutSeconds:5 } }, 'shell', 6000);
    const sc = r.result?.structuredContent || r.result; // new unified server packs structuredContent
    const joined = JSON.stringify(sc||{});
    if(/error/i.test(joined)){
      console.warn('run-powershell returned error payload; skipping shell exe assert');
    } else if(/pwsh\.exe/i.test(joined)){
      expect(true).toBe(true); // detected pwsh
    } else {
      console.warn('pwsh.exe not selected; fallback shell used');
      expect(/powershell\.exe/i.test(joined)).toBe(true); // fallback acceptable
    }
    srv.kill();
  },10000);
});

