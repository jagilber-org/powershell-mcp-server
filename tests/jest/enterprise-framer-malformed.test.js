const { spawn } = require('child_process');

function makeFrame(raw){ return `Content-Length: ${Buffer.byteLength(raw,'utf8')}`+"\r\n\r\n"+raw; }

function collect(stdoutBuf){ const frames=[]; let s=stdoutBuf; while(true){ const h=s.indexOf('\r\n\r\n'); if(h===-1) break; const head=s.slice(0,h); const m=/Content-Length: (\d+)/i.exec(head); if(!m) break; const len=parseInt(m[1],10); const start=h+4; if(s.length < start+len) break; const body=s.slice(start,start+len); try{ frames.push(JSON.parse(body)); }catch{} s=s.slice(start+len);} return frames; }

test('enterprise framer rejects BOM + extra blank line (graceful)', done => {
  const ps = spawn('node',['dist/server.js','--framer-stdio','--quiet'], { stdio:['pipe','pipe','pipe'] });
  let stderr=''; let stdout='';
  ps.stderr.on('data', d=> stderr += d.toString());
  ps.stdout.on('data', d=> { stdout += d.toString(); const frames=collect(stdout); if(frames.length>0){ /* ignore */ } });
  const bom='\uFEFF';
  const badHeader=`Content-Length: 52\r\n\r\n\r\n`+bom; // extra blank line then BOM before JSON
  const body='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
  ps.stdin.write(badHeader+body);
  setTimeout(()=>{ try{ ps.kill(); }catch{}; expect(stderr).toMatch(/FRAMER|enterprise/i); done(); }, 1000);
}, 5000);

test('enterprise framer ignores malformed header (no crash)', done => {
  const ps = spawn('node',['dist/server.js','--framer-stdio','--quiet'], { stdio:['pipe','pipe','pipe'] });
  let stderr='';
  ps.stderr.on('data', d=> stderr += d.toString());
  ps.stdin.write('Content-Length: ABC\r\n\r\n'); // invalid length
  setTimeout(()=>{ try{ ps.kill(); }catch{}; expect(stderr).toMatch(/framer|enterprise/i); done(); }, 800);
}, 4000);
