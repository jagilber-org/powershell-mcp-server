const { startServer, waitForReady, collect, rpc } = require('./util');

async function waitFor(res,id,ms=15000){ const end=Date.now()+ms; while(Date.now()<end){ if(res[id]) return res[id]; await new Promise(r=> setTimeout(r,100)); } return res[id]; }

// This test ensures that when a command times out after producing some stdout/stderr,
// the partial output generated before timeout is still returned to the client.
describe('run-powershell timeout preserves partial output', ()=>{
  test('emits initial lines before enforced timeout', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
  // Command: continuous loop emitting stdout lines; inject a single stderr line early; rely on timeout to terminate.
  const cmd = '$i=0; while($true){ $i++; Write-Output "LINE$i"; if($i -eq 3){ Write-Error "ERR_BEFORE_TIMEOUT" }; Start-Sleep -Milliseconds 120 }';
  rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: cmd, confirmed:true, timeoutSeconds:2 }},'partial');
    const msg = await waitFor(res,'partial',20000); srv.kill(); expect(msg).toBeTruthy();
    const sc = msg.result?.structuredContent || {};
    expect(sc.timedOut || sc.exitCode === 124).toBe(true);
    // We should have received multiple LINE outputs but not the final NEVER marker
    const out = msg.result?.content?.map(c=>c.text||'').join('\n') || '';
    expect(/LINE1/.test(out)).toBe(true);
  expect(/LINE5/.test(out) || /LINE6/.test(out) || /LINE7/.test(out)).toBe(true); // at least several lines
  // stderr snapshot presence (may appear only in structured stderr). If not present treat as soft pass (some shells may coalesce formatting)
  const stderrText = sc.stderr || out;
  expect(/ERR_BEFORE_TIMEOUT/.test(stderrText)).toBe(true);
    // Flag showing we captured a timeout snapshot
    expect(sc.timeoutSnapshot).toBe(true);
  }, 30000);
});
