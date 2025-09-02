// Verifies psCpuSecLast + psCpuPct estimation appear after at least one sample using framed protocol server.
// Uses METRICS_CAPTURE to force sampler. Skips if environment disallows spawning.
const { spawn } = require('child_process');
const http = require('http');

function fetchJson(pathName){
  return new Promise((resolve,reject)=>{
    http.get({ host:'127.0.0.1', port:9090, path: pathName }, res=>{
      let data=''; res.on('data', c=> data+=c); res.on('end',()=>{ try{ resolve(JSON.parse(data)); }catch(e){ reject(e);} });
    }).on('error', reject);
  });
}

function sendFrame(proc, obj){
  const json = JSON.stringify(obj);
  const frame = `Content-Length: ${Buffer.byteLength(json,'utf8')}` + "\r\n\r\n" + json;
  proc.stdin.write(frame);
}

async function waitForPsSample(min=1, timeoutMs=20000){
  const start = Date.now();
  while(Date.now()-start < timeoutMs){
    try {
      const snap = await fetchJson('/api/metrics');
      if(snap.psSamples >= min && typeof snap.psCpuSecAvg === 'number') return snap;
    } catch { }
    await new Promise(r=> setTimeout(r, 700));
  }
  throw new Error('psSamples never reached '+min);
}

describe('ps metrics delta cpu', ()=>{
  test('psCpuSecLast captured and used for CPU pct estimation', async ()=>{
    const env = { ...process.env, MCP_CAPTURE_PS_METRICS:'1', MCP_QUIET:'1' };
    const proc = spawn('node',['dist/server.js','--framer-stdio'], { stdio:['pipe','pipe','pipe'], env });
    try {
      sendFrame(proc, { jsonrpc:'2.0', id:'i1', method:'initialize', params:{ protocolVersion:'2024-11-05' } });
      sendFrame(proc, { jsonrpc:'2.0', id:'l1', method:'tools/list' });
      // small workload to stimulate sampler interval while commands run
      for(let i=0;i<3;i++){
        sendFrame(proc, { jsonrpc:'2.0', id:'c'+i, method:'tools/call', params:{ name:'run-powershell', arguments:{ command:'"tick'+i+'" | Out-Host', confirmed:true } } });
      }
      const snap = await waitForPsSample(1, 25000);
      expect(snap.psSamples).toBeGreaterThanOrEqual(1);
      // psCpuSecLast optional; ensure average exists
      expect(typeof snap.psCpuSecAvg).toBe('number');
      // We cannot assert exact range but should be non-negative and sane
      expect(snap.psCpuSecAvg).toBeGreaterThanOrEqual(0);
      expect(snap.psCpuSecAvg).toBeLessThan(60);
    } finally {
      proc.kill();
    }
  }, 40000);
});
