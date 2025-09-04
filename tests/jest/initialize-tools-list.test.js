const { spawn } = require('child_process');

function sendFrame(proc, obj){
  const json = JSON.stringify(obj);
  const frame = `Content-Length: ${Buffer.byteLength(json,'utf8')}` + "\r\n\r\n" + json;
  proc.stdin.write(frame);
}

function collectFrames(proc, predicate, timeout=4000){
  return new Promise((resolve,reject)=>{
    let buf='';
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('timeout waiting output')); }, timeout);
    function onData(d){
      buf += d.toString();
      if(predicate(buf)){ cleanup(); resolve(buf); }
    }
    function cleanup(){ clearTimeout(timer); proc.stdout.off('data', onData); }
    proc.stdout.on('data', onData);
  });
}

function parseFrames(raw){
  const messages = [];
  let rest = raw;
  while(true){
    const h = rest.indexOf('\r\n\r\n');
    if(h===-1) break;
    const header = rest.slice(0,h);
    const m = /Content-Length: (\d+)/i.exec(header);
    if(!m) break;
    const len = parseInt(m[1],10);
    const bodyStart = h+4;
    if(rest.length < bodyStart + len) break;
    const body = rest.slice(bodyStart, bodyStart+len);
    rest = rest.slice(bodyStart+len);
    try { messages.push(JSON.parse(body)); } catch {}
  }
  return messages;
}

describe('initialize + tools/list compliance (framed protocol only)', ()=>{
  test('core tools surfaced with schemas, admin hidden', async ()=>{
  const proc = spawn('node',['dist/server.js','--framer-stdio'], { stdio:['pipe','pipe','pipe'], env: { ...process.env } });
    // Send initialize then tools/list
    sendFrame(proc, { jsonrpc:'2.0', id:'i1', method:'initialize', params:{ protocolVersion:'2024-11-05' } });
    sendFrame(proc, { jsonrpc:'2.0', id:'l1', method:'tools/list' });
    const output = await collectFrames(proc, o=> o.includes('"id":"l1"'));
    proc.kill();
    const messages = parseFrames(output);
    const init = messages.find(m=> m.id==='i1');
    expect(init).toBeTruthy();
    const listMsg = messages.find(m=> m.id==='l1');
    expect(listMsg).toBeTruthy();
    const tools = listMsg.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    const names = tools.map(t=> t.name).sort();
    const expected = ['run_powershell','powershell_syntax_check','emit_log','working_directory_policy','server_stats','help'];
    for(const n of expected){ expect(names).toContain(n); }
    expect(names).not.toContain('tool-tree');
    const rp = tools.find(t=> t.name==='run_powershell');
    expect(rp).toBeTruthy();
    expect(rp.inputSchema && typeof rp.inputSchema === 'object').toBe(true);
    const propCount = Object.keys(rp.inputSchema.properties||{}).length;
    // Expect at least core + adaptive parameters
    expect(propCount).toBeGreaterThanOrEqual(6);
  }, 8000);
});

// NOTE: Legacy line protocol tests intentionally removed. All communication must use framed Content-Length protocol.
