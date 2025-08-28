const { spawn } = require('child_process');

function frame(obj){ const s=JSON.stringify(obj); return `Content-Length: ${Buffer.byteLength(s,'utf8')}`+"\r\n\r\n"+s; }
function parse(buf){ const out=[]; let s=buf; while(true){ const h=s.indexOf('\r\n\r\n'); if(h===-1) break; const head=s.slice(0,h); const m=/Content-Length: (\d+)/i.exec(head); if(!m) break; const len=parseInt(m[1],10); const start=h+4; if(s.length<start+len) break; const body=s.slice(start,start+len); try{ out.push(JSON.parse(body)); }catch{} s=s.slice(start+len);} return { frames:out, rest:s }; }

test('rate limiting engages over burst', done => {
  const ps = spawn('node',['dist/server.js','--framer-stdio','--quiet'], { stdio:['pipe','pipe','pipe'] });
  const total=15; // exceed configured burst (from config) to trigger limits
  let stdoutBuf=''; let sent=false; let errorCount=0; let responseCount=0;
  function send(obj){ ps.stdin.write(frame(obj)); }
  function processFrames(){
    const { frames, rest } = parse(stdoutBuf); stdoutBuf=rest;
    for(const f of frames){
      if(!sent && f.result && f.result.serverInfo){
        sent=true;
        for(let i=0;i<total;i++){
          send({ jsonrpc:'2.0', id:100+i, method:'tools/call', params:{ name:'run-powershell', arguments:{ command:'Write-Output RATE', confirmed:true } } });
        }
      } else if(f.id>=100 && f.id<100+total){
        responseCount++;
        // Detect rate limit inside successful result content
        try {
          if(f.result && Array.isArray(f.result.content)){
            for(const c of f.result.content){
              if(c && typeof c.text==='string' && /rate limit exceeded/i.test(c.text)){
                errorCount++; break;
              }
              // Some tools may return a JSON string; attempt parse
              if(c && typeof c.text==='string' && c.text.startsWith('{')){
                try { const obj = JSON.parse(c.text); if(obj.rateLimited) { errorCount++; break; } } catch{}
              }
            }
          }
        } catch{}
        if(responseCount===total){
          try{ ps.kill(); }catch{}
          expect(responseCount).toBe(total);
          expect(errorCount).toBeGreaterThan(0); // some calls should be limited
          done();
        }
      }
    }
  }
  ps.stdout.on('data', d=> { stdoutBuf += d.toString(); processFrames(); });
  ps.stderr.on('data', ()=>{});
  send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{} } });
  setTimeout(()=>{ if(!sent){ try{ps.kill();}catch{}; done(new Error('No initialize response. Raw stdout='+stdoutBuf)); } }, 12000);
}, 20000);

