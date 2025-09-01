import { spawn } from 'child_process';

// Framed protocol helper
function sendFrame(proc, obj){
  const json = JSON.stringify(obj);
  const frame = `Content-Length: ${Buffer.byteLength(json,'utf8')}` + "\r\n\r\n" + json;
  proc.stdin.write(frame);
}

let buffer='';
function parseFrames(data){
  buffer += data.toString();
  const messages=[];
  while(true){
    const idx = buffer.indexOf('\r\n\r\n');
    if(idx === -1) break;
    const header = buffer.slice(0, idx);
    const m = /Content-Length: (\d+)/i.exec(header);
    if(!m) { buffer = buffer.slice(idx+4); continue; }
    const len = parseInt(m[1],10);
    const total = idx+4+len;
    if(buffer.length < total) break;
    const json = buffer.slice(idx+4, total);
    buffer = buffer.slice(total);
    try { messages.push(JSON.parse(json)); } catch {}
  }
  return messages;
}

const proc = spawn('node',['dist/mcpServer.js'], { stdio:['pipe','pipe','inherit'], env: { ...process.env, MCP_FRAMED_STDIO:'1' } });
const collected=[];
proc.stdout.on('data', d=> { const msgs = parseFrames(d); collected.push(...msgs); });

setTimeout(()=>{
  sendFrame(proc, { jsonrpc:'2.0', id:'i1', method:'initialize', params:{ protocolVersion:'2024-11-05' }});
  sendFrame(proc, { jsonrpc:'2.0', id:'l1', method:'tools/list' });
},150);

setTimeout(()=>{
  try { proc.kill(); } catch {}
  console.log('RAW_OUTPUT_START');
  console.log(JSON.stringify(collected, null, 2));
  console.log('RAW_OUTPUT_END');
}, 900);
