const { spawn } = require('child_process');

function sendFrame(proc, obj){
  const json = JSON.stringify(obj);
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(json,'utf8')}`+"\r\n\r\n"+json);
}

function collect(proc, untilId, timeout=4000){
  return new Promise((resolve,reject)=>{
    let buf='';
    const timer = setTimeout(()=>{ reject(new Error('timeout')); }, timeout);
    proc.stdout.on('data', d=>{
      buf += d.toString();
      if(buf.includes(`"id":"${untilId}"`)){
        clearTimeout(timer); resolve(buf);
      }
    });
  });
}

function parseAll(raw){
  const msgs=[]; let rest=raw;
  while(true){
    const h = rest.indexOf('\r\n\r\n'); if(h===-1) break;
    const m = /Content-Length: (\d+)/i.exec(rest.slice(0,h)); if(!m) break;
    const len = parseInt(m[1],10); const bodyStart = h+4; if(rest.length < bodyStart+len) break;
    const body = rest.slice(bodyStart, bodyStart+len); rest = rest.slice(bodyStart+len);
    try { msgs.push(JSON.parse(body)); } catch {}
  }
  return msgs;
}

describe('run-powershell missing param error is agent-friendly', ()=>{
  test('returns structured error data with minimal schema', async ()=>{
    const proc = spawn('node',['dist/server.js','--framer-stdio'], { stdio:['pipe','pipe','pipe'] });
    sendFrame(proc,{ jsonrpc:'2.0', id:'i1', method:'initialize', params:{ protocolVersion:'2024-11-05' }});
    sendFrame(proc,{ jsonrpc:'2.0', id:'c1', method:'tools/call', params:{ name:'run-powershell', arguments:{} }});
    const raw = await collect(proc,'c1');
    proc.kill();
    const messages = parseAll(raw);
    const errMsg = messages.find(m=> m.id==='c1' && m.error);
    expect(errMsg).toBeTruthy();
    expect(errMsg.error.code).toBe(-32602); // Invalid params
    expect(errMsg.error.data).toBeTruthy();
    const d = errMsg.error.data;
    expect(d.agentFriendly).toBe(true);
    expect(d.requiredOneOf).toContain('command');
    expect(d.minimalSchema).toBeTruthy();
    expect(d.example.command).toBe('Get-Date');
  }, 8000);
});
