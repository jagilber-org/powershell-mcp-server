const { startServer, waitForReady, collect, rpc } = require('./util');

function parse(res, id){
  const msg = res[id]; if(!msg) return null; try { return JSON.parse(msg.result?.content?.[0]?.text||'{}'); } catch { return null; }
}

async function waitFor(responses, ids, timeoutMs){
  const end = Date.now()+timeoutMs; while(Date.now()<end){
    if(ids.every(id=> responses[id])) return true; await new Promise(r=> setTimeout(r,120));
  } return false;
}

describe('long-running memory + watchdog stress', ()=>{
  test('sustained allocations remain bounded', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    // Warm baseline (after initial server allocations) + GC
    rpc(srv,'tools/call',{ name:'memory-stats', arguments:{ gc:true }},'baseline');
    await waitFor(res,['baseline'],4000);
    const base = parse(res,'baseline');
    expect(base).toBeTruthy();

    const iterations = 80; // adjustable; each spawns separate pwsh process
    for(let i=0;i<iterations;i++){
      // Allocate several thousand objects and strings to pressure heap inside child; Out-Null to suppress output
      rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'1..2500 | % { [pscustomobject]@{A=$_;B=\'X\'*400} } | Out-Null', confirmed:true, timeout:10 }}, 'alloc'+i);
    }
    await waitFor(res, Array.from({length:iterations},(_,i)=>'alloc'+i), 90000);

    // Final GC + sample
    rpc(srv,'tools/call',{ name:'memory-stats', arguments:{ gc:true }},'final');
    await waitFor(res,['final'],6000);
    srv.kill();
    const final = parse(res,'final');
    expect(final).toBeTruthy();
    if(base && final){
      const growth = final.heapUsedMB - base.heapUsedMB;
      // Generous bound: allow up to 30MB net growth over many child invocations
      expect(growth).toBeLessThan(30);
    }
  }, 180000);

  test('repeated hung commands cleaned by watchdog (no runaway memory)', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'memory-stats', arguments:{ gc:true }},'hangBase');
    await waitFor(res,['hangBase'],4000);
    const base = parse(res,'hangBase');
    expect(base).toBeTruthy();
    const runs = 25;
    for(let i=0;i<runs;i++){
      // Command that would wait 20s but tool timeout will be 1s triggering watchdog
      rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Wait-Event -SourceIdentifier never-happens -Timeout 20', confirmed:true, timeoutSeconds:1 }}, 'hang'+i);
    }
    await waitFor(res, Array.from({length:runs},(_,i)=>'hang'+i), 60000);
    rpc(srv,'tools/call',{ name:'memory-stats', arguments:{ gc:true }},'hangFinal');
    await waitFor(res,['hangFinal'],6000);
    srv.kill();
    const final = parse(res,'hangFinal');
    expect(final).toBeTruthy();
    if(base && final){
      const growth = final.heapUsedMB - base.heapUsedMB;
      // Hanging processes should not leak; allow tiny slack
      expect(growth).toBeLessThan(10);
    }
  }, 120000);
});


