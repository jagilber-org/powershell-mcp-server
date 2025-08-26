const { spawn } = require('child_process');
const os = require('os');

function runServer(env, commands){
  return new Promise((resolve)=>{
    const proc = spawn(process.execPath,['dist/server.js','--quiet'], { stdio:['pipe','pipe','pipe'], env:{...process.env,...env} });
    let responses = {}; let buf='';
    proc.stdout.on('data', d=>{ buf+=d.toString(); const lines=buf.split(/\n/); buf=lines.pop(); for(const line of lines){ if(!line.trim()) continue; try{ const msg=JSON.parse(line); if(msg.id) responses[msg.id]=msg; }catch{} } });
    proc.stderr.on('data',()=>{});
    proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})+'\n');
    let sent=0; const total=commands.length; const start=Date.now();
    const sendNext=()=>{
      if(sent>=total){ return; }
      const id=sent+2; proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'run-powershell',arguments:{command:commands[sent],confirmed:true}}})+'\n'); sent++; if(sent<total) setImmediate(sendNext);
    };
    const check=()=>{
      if(Object.keys(responses).length>=commands.length+1){ const elapsed=Date.now()-start; proc.kill(); resolve({elapsed, count:commands.length}); } else setTimeout(check,50);
    };
    setTimeout(()=>{ sendNext(); check(); },400);
  });
}

function buildCommands(n){ return Array.from({length:n},(_,i)=>`Write-Output ${i}`); }

describe('perf baseline ps metrics flag', ()=>{
  test('compare enabled vs disabled throughput', async ()=>{
    const cmds = buildCommands(30);
    const disabled = await runServer({ MCP_CAPTURE_PS_METRICS:'0' }, cmds);
    const enabled = await runServer({ MCP_CAPTURE_PS_METRICS:'1' }, cmds);
    // Allow enabled to be at most 25% slower; this is a sanity guard not a strict perf test
    const slowdown = (enabled.elapsed - disabled.elapsed)/disabled.elapsed;
    console.log('Perf baseline disabled', disabled, 'enabled', enabled, 'slowdown', slowdown);
    expect(slowdown).toBeLessThan(0.25);
  }, 90000);
});
