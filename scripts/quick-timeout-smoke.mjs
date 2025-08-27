import { spawn } from 'child_process';

function startServer(){
  const proc = spawn('node',['dist/server.js'],{stdio:['pipe','pipe','pipe']});
  return proc;
}

function send(proc,id,method,params){
  proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params })+'\n');
}

function callTool(proc,id,name,args){
  send(proc,id,'tools/call',{ name, arguments: args });
}

async function wait(responses,id,ms=5000){
  const end = Date.now()+ms; while(Date.now()<end){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,60)); }
  return responses[id];
}

(async()=>{
  const server = startServer();
  const responses = {}; let buf='';
  server.stdout.on('data', d=>{ buf+=d.toString(); const lines=buf.split(/\n/); buf=lines.pop(); for(const l of lines){ if(!l.trim()) continue; try { const m=JSON.parse(l); if(m.id){ responses[m.id]=m; } } catch {} } });
  // Give server brief startup time
  await new Promise(r=> setTimeout(r,400));

  // Fast command (expect success well under timeout=1s)
  callTool(server,'fast','run-powershell',{ command:'Write-Output "fast-ok"', timeout:1, confirmed:true });
  // Hang command (sleep 5s) with 1s timeout -> expect timedOut metadata
  callTool(server,'hang','run-powershell',{ command:'Start-Sleep -Seconds 5; Write-Output "late"', timeout:1, confirmed:true });
  // Learn tool quick probe (list minimal)
  callTool(server,'learn1','learn',{ action:'list', limit:5 });

  const fast = await wait(responses,'fast',4000);
  const hang = await wait(responses,'hang',6000);
  const learn = await wait(responses,'learn1',3000);

  server.kill();

  function summarize(label,msg){
    if(!msg){ console.log(label+': NO_RESPONSE'); return; }
    if(msg.result){
      const sc = msg.result.structuredContent || {}; // run-powershell path
      const text = (msg.result.content||[]).map(c=>c.text||'').join('\n');
      console.log(label+':', JSON.stringify({ id:msg.id, success: sc.success, exitCode: sc.exitCode, timedOut: sc.timedOut, originalTimeoutSeconds: sc.originalTimeoutSeconds, effectiveTimeoutMs: sc.effectiveTimeoutMs, stdoutSample: text.slice(0,60) }, null, 2));
    } else if(msg.error){
      console.log(label+': ERROR', msg.error);
    } else {
      console.log(label+': RAW', JSON.stringify(msg));
    }
  }

  summarize('FAST', fast);
  summarize('HANG', hang);
  summarize('LEARN', learn);

  if(hang?.result?.structuredContent?.timedOut !== true){
    console.error('WARNING: Expected hang command to time out with timeout=1s');
    process.exitCode = 1;
  }
})();
