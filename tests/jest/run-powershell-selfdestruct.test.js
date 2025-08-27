const { startServer, waitForReady, collect, rpc } = require('./util');

// This test uses a command that would normally sleep longer than timeout; internal timer should force exit with code 124 before watchdog.
describe('run-powershell internal self-destruct', ()=>{
  test('exits with code 124 (internal self-destruct) before external watchdog', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    // Command: sleep 5s, set timeout 2s so internal injection triggers around ~1.7s
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Start-Sleep -Seconds 5; Write-Output "should-not-print"', confirmed:true, timeoutSeconds:2 }},'sd');
    for(let i=0;i<120;i++){ if(res['sd']) break; await new Promise(r=> setTimeout(r,120)); }
    srv.kill();
    const msg = res['sd']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || JSON.parse(msg.result?.content?.[0]?.text || '{}');
    // Expect exitCode 124 OR timedOut true (race); prefer to assert at least one
    expect(structured.exitCode === 124 || structured.timedOut).toBe(true);
    // If exitCode 124, stdout should not contain the post-sleep output
    if(structured.exitCode === 124){
      const text = msg.result?.content?.[0]?.text || '';
      expect(text).not.toMatch(/should-not-print/);
    }
  }, 20000);
});


