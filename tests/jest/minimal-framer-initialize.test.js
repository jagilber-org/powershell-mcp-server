const { spawn } = require('child_process');

function frame(obj){ const json = JSON.stringify(obj); return `Content-Length: ${Buffer.byteLength(json,'utf8')}\r\n\r\n${json}`; }

function send(proc, msg){ proc.stdin.write(frame(msg)); }

function collectFrames(buffer){
  const out = [];
  let buf = buffer;
  while(true){
    const headerEnd = buf.indexOf('\r\n\r\n'); if(headerEnd === -1) break;
    const header = buf.slice(0, headerEnd);
    const m = /Content-Length:\s*(\d+)/i.exec(header); if(!m){ buf = buf.slice(headerEnd+4); continue; }
    const len = parseInt(m[1],10); const total = headerEnd+4+len; if(buf.length < total) break;
    const body = buf.slice(headerEnd+4, total); out.push(JSON.parse(body)); buf = buf.slice(total);
  }
  return { frames: out, rest: buf };
}

test('minimal framer initialize -> list -> call', done => {
  const ps = spawn('node', ['dist/minimalServer.js'], { stdio:['pipe','pipe','pipe'] });
  let stdoutBuf = '';
  ps.stdout.on('data', d=>{ stdoutBuf += d.toString(); processFrames(); });
  let step = 0;
  function processFrames(){
    const { frames } = collectFrames(stdoutBuf); // simple one-shot parse (we won't keep rest for brevity)
    if(step === 0 && frames.find(f=>f.result && f.result.serverInfo)){
      step = 1;
      send(ps,{ jsonrpc:'2.0', id:2, method:'tools/list' });
    }
    if(step === 1 && frames.find(f=>f.result && f.result.tools)){ step = 2; send(ps,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'run-powershell', arguments:{ command:'Write-Output TESTMIN' } } }); }
    if(step === 2 && frames.find(f=>f.result && f.result.preview && f.result.preview.includes('TESTMIN'))){ step=3; ps.kill(); done(); }
  }
  // Kick off initialize
  send(ps,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ clientInfo:{ name:'jest', version:'1' } } });
  setTimeout(()=>{ if(step<3){ try{ps.kill();}catch{}; done.fail('Did not reach final step'); } }, 8000);
});
