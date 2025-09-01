/**
 * Minimal framed MCP-compatible server used only for lightweight initialize/tools/call test.
 * Provides a very small subset of functionality: initialize, tools/list and run-powershell.
 * It purposefully avoids the richer enterprise server surface to keep startup fast.
 */
import { runPowerShellTool } from './tools/runPowerShell.js';

interface JsonRpcRequest { jsonrpc:string; id?:string|number; method:string; params?:any; }
interface JsonRpcResponse { jsonrpc:'2.0'; id?:string|number; result?:any; error?:{ code:number; message:string; data?:any }; }

function writeFrame(obj:JsonRpcResponse){
  const json = JSON.stringify(obj);
  const frame = `Content-Length: ${Buffer.byteLength(json,'utf8')}` + "\r\n\r\n" + json;
  process.stdout.write(frame);
}

function handleRequest(req:JsonRpcRequest){
  if(req.method === 'initialize'){
    writeFrame({ jsonrpc:'2.0', id:req.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{ listChanged:true } }, serverInfo:{ name:'minimal-pwsh', version:'1.0.0' } }});
    return;
  }
  if(req.method === 'tools/list'){
    writeFrame({ jsonrpc:'2.0', id:req.id, result:{ tools:[{ name:'run-powershell', description:'Execute PowerShell command', inputSchema:{ type:'object', properties:{ command:{ type:'string' }, script:{ type:'string' }, timeoutSeconds:{ type:'number' } } } }] }});
    return;
  }
  if(req.method === 'tools/call'){
    const name = req.params?.name;
    const args = req.params?.arguments || {};
    if(name !== 'run-powershell'){
      writeFrame({ jsonrpc:'2.0', id:req.id, error:{ code:-32601, message:`Unknown tool: ${name}` } });
      return;
    }
    runPowerShellTool(args).then(r=>{
      const stdout = r.structuredContent?.stdout || '';
      const preview = stdout.slice(0,120);
      writeFrame({ jsonrpc:'2.0', id:req.id, result:{ preview, ...r } });
    }).catch(e=>{
      writeFrame({ jsonrpc:'2.0', id:req.id, error:{ code:-32603, message: e?.message || String(e) } });
    });
    return;
  }
  writeFrame({ jsonrpc:'2.0', id:req.id, error:{ code:-32601, message:`Unknown method ${req.method}` } });
}

let buffer='';
process.stdin.on('data', chunk=>{
  buffer += chunk.toString();
  while(true){
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if(headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if(!m){ buffer = buffer.slice(headerEnd+4); continue; }
    const len = parseInt(m[1],10);
    const total = headerEnd + 4 + len;
    if(buffer.length < total) break; // wait for full body
    const body = buffer.slice(headerEnd+4, total);
    buffer = buffer.slice(total);
    try {
      const req = JSON.parse(body) as JsonRpcRequest;
      handleRequest(req);
    } catch {/* ignore parse errors */}
  }
});
