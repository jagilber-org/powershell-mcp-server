const { spawn } = require('child_process');

function frame(obj){ const s=JSON.stringify(obj); return `Content-Length: ${Buffer.byteLength(s,'utf8')}`+"\r\n\r\n"+s; }
function parse(buf){ const out=[]; let s=buf; while(true){ const h=s.indexOf('\r\n\r\n'); if(h===-1) break; const head=s.slice(0,h); const m=/Content-Length: (\d+)/i.exec(head); if(!m) break; const len=parseInt(m[1],10); const start=h+4; if(s.length<start+len) break; const body=s.slice(start,start+len); try{ out.push(JSON.parse(body)); }catch{} s=s.slice(start+len);} return { frames:out, rest:s }; }

test('rate limiting engages over burst', async () => {
  const ps = spawn('node',['dist/server.js','--framer-stdio','--quiet'], { stdio:['pipe','pipe','pipe'] });
  const total=15; // exceed configured burst (from config) to trigger limits
  let stdoutBuf=''; let sent=false; let errorCount=0; let responseCount=0;
  function send(obj){ ps.stdin.write(frame(obj)); }
  ps.stdout.on('data', d=> { stdoutBuf += d.toString(); });
  ps.stderr.on('data', ()=>{});
  send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{} } });
  const start = Date.now();
  // Wait for initialize response
  while(Date.now()-start < 10000 && !/serverInfo/.test(stdoutBuf)){
    await new Promise(r=> setTimeout(r,120));
  }
  if(!/serverInfo/.test(stdoutBuf)){
    try{ ps.kill(); }catch{}
    throw new Error('No initialize response. Raw stdout='+stdoutBuf);
  }
  // Send burst
  for(let i=0;i<total;i++){
    send({ jsonrpc:'2.0', id:100+i, method:'tools/call', params:{ name:'run-powershell', arguments:{ command:'"RATE" | Out-Host', confirmed:true } } });
  }
  const frameIds = new Set(Array.from({length:total},(_,i)=>100+i));
  const deadline = Date.now()+15000;
  while(Date.now()<deadline && responseCount<total){
    const parsed = parse(stdoutBuf);
    stdoutBuf = parsed.rest;
    for(const f of parsed.frames){
      if(frameIds.has(f.id)){
        responseCount++;
        // Detect rate limit markers
        try {
          if(f.error && (f.error.code===-32001 || /rate limit/i.test(f.error.message))){ errorCount++; }
          if(f.result && Array.isArray(f.result.content)){
            for(const c of f.result.content){
              if(c && typeof c.text==='string'){
                if(/rate limit exceeded/i.test(c.text)){ errorCount++; break; }
                if(c.text.startsWith('{')){ try { const obj=JSON.parse(c.text); if(obj.rateLimited) { errorCount++; break; } } catch{} }
              }
            }
          }
        } catch{}
      }
    }
    await new Promise(r=> setTimeout(r,120));
  }
  try{ ps.kill(); }catch{}
  expect(responseCount).toBe(total);
  expect(errorCount).toBeGreaterThan(0);
}, 25000);

