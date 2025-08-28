const { startServer, waitForReady, collect, rpc } = require('./util');

function parseLine(res, key){
  const msg = res[key];
  if(!msg) return null;
  try { return JSON.parse(msg.result?.content?.[0]?.text||'{}'); } catch { return null; }
}

describe('memory-stats tool leak heuristic', ()=>{
  test('heap usage does not grow unbounded over repeated executions', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    // Warmup GC sample
    rpc(srv,'tools/call',{ name:'memory-stats', arguments:{ gc:true }},'mem0');
    for(let i=0;i<40;i++){ if(res['mem0']) break; await new Promise(r=> setTimeout(r,50)); }
    const base = parseLine(res,'mem0');

    // Run multiple run-powershell invocations that allocate some objects
    const iterations = 12;
    for(let i=0;i<iterations;i++){
      rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'1..500 | % { [pscustomobject]@{N=$_} } | Out-Null', confirmed:true, timeout:5 }},'exec'+i);
    }
    for(let i=0;i<120;i++){ // wait for last exec
      if(res['exec'+(iterations-1)]) break; await new Promise(r=> setTimeout(r,100));
    }

    // Final GC + sample
    rpc(srv,'tools/call',{ name:'memory-stats', arguments:{ gc:true }},'memFinal');
    for(let i=0;i<40;i++){ if(res['memFinal']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();

    const final = parseLine(res,'memFinal');
    expect(base).toBeTruthy();
    expect(final).toBeTruthy();

    if(base && final){
      const growth = final.heapUsedMB - base.heapUsedMB;
      // Allow some growth (< 15MB) to account for module loads & caches, fail if excessive
      expect(growth).toBeLessThan(15);
    }
  }, 45000);
});

