const { spawn } = require('child_process');

function frame(obj){ const s=JSON.stringify(obj); return `Content-Length: ${Buffer.byteLength(s,'utf8')}`+"\r\n\r\n"+s; }

function parseFrames(buf){ const out=[]; let s=buf; while(true){ const h=s.indexOf('\r\n\r\n'); if(h===-1) break; const header=s.slice(0,h); const m=/Content-Length: (\d+)/i.exec(header); if(!m) break; const len=parseInt(m[1],10); const start=h+4; if(s.length < start+len) break; const body=s.slice(start,start+len); out.push(JSON.parse(body)); s=s.slice(start+len); } return { frames: out, rest: s }; }

test('enterprise framer initialize -> list -> call', (done) => {
  const ps = spawn('node', ['dist/server.js','--framer-stdio','--quiet'], { stdio:['pipe','pipe','pipe'] });
  let stdoutBuf='';
  let step=0;
  function send(obj){ ps.stdin.write(frame(obj)); }
  function processFrames(){
    const { frames, rest } = parseFrames(stdoutBuf); stdoutBuf=rest;
    for(const f of frames){
      if(step===0 && f.result && f.result.serverInfo){
        step=1; send({ jsonrpc:'2.0', id:2, method:'tools/list' });
      } else if(step===1 && f.result && Array.isArray(f.result.tools)){
        expect(f.result.tools.length).toBeGreaterThan(5);
        step=2; send({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'run-powershell', arguments:{ command:'Write-Output TESTFRAMER', confirmed:true } } });
      } else if(step===2 && f.result && f.result.content){
        const joined = f.result.content.map(c=>c.text||'').join('');
        expect(joined).toMatch(/TESTFRAMER/);
        try{ ps.kill(); }catch{}
        done();
      }
    }
  }
  ps.stdout.on('data', d=> { stdoutBuf += d.toString(); processFrames(); });
  let stderrBuf='';
  ps.stderr.on('data', d=> { stderrBuf += d.toString(); });
  send({ jsonrpc:'2.0', id:1, method:'initialize', params:{} });
  setTimeout(()=>{ if(step<2){ try{ps.kill();}catch{}; done(new Error('Did not complete handshake. STDERR:\n'+stderrBuf)); } }, 15000);
}, 20000);
