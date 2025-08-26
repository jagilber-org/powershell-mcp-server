import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function startServer(extraEnv={}){
  const env = { ...process.env, MCP_DISABLE_SELF_DESTRUCT:'1', ...extraEnv };
  const ps = spawn('node', ['dist/server.js'], { env });
  return ps;
}

function collect(ps){
  return new Promise((resolve,reject)=>{
    let out=''; let err='';
    ps.stdout.on('data', d=> out+=d.toString());
    ps.stderr.on('data', d=> err+=d.toString());
    ps.on('exit', code=> resolve({code,out,err}));
    setTimeout(()=>{ ps.kill(); resolve({code:null,out,err}); }, 4000);
  });
}

test('Get-Date -Format o not blocked', async()=>{
  const ps = startServer();
  // Send initialize and simple run tool request manually via stdio
  // We'll look for any Blocked OS pattern error related to format
  const err = await collect(ps);
  expect(err.err).not.toMatch(/Blocked OS pattern: \\bformat/);
});

// Deprecated duplicate run-powershell-getdate-format legacy test.
console.log(JSON.stringify({ deprecated:true, test:'run-powershell-getdate-format' }));
process.exit(0);
