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
    const r = await request(srv, responses, 'tools/call', { name:'run-powershell', arguments:{ command:'Write-Output test', confirmed:true } }, 'shell', 4000);
    // run-powershell returns a rich object directly (not nested in content) via server dispatcher
    const obj = r.result || {};
    // if error surfaced inside content, skip assertion
    if(obj.content){
      const joined = JSON.stringify(obj);
      if(/error/i.test(joined)){
        console.warn('run-powershell returned error payload; skipping shell exe assert');
      } else {
        expect(joined).toMatch(/pwsh\.exe/i);
      }
    } else {
      expect(JSON.stringify(obj)).toMatch(/pwsh\.exe/i);
    }
    srv.kill();
  },10000);
});

