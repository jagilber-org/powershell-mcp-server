#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const REQUESTS = parseInt(process.env.STRESS_REQUESTS||'200',10);
const CONCURRENCY = parseInt(process.env.STRESS_CONCURRENCY||'20',10);
const OUTDIR = 'metrics';
fs.mkdirSync(OUTDIR,{recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const outfile = path.join(OUTDIR,`stress-${stamp}.json`);

function send(proc,obj){ proc.stdin.write(JSON.stringify(obj)+'\n'); }

const server = spawn('node',['dist/server.js'],{stdio:['pipe','pipe','pipe']});
server.stderr.on('data',d=>process.stderr.write(d));
let started=false, sent=0, done=0, errors=0; const durations=[];
const startTime = Date.now();

function fireBatch(){
  while(sent<REQUESTS && (sent-done)<CONCURRENCY){
    const id = 1000+sent;
    const t0 = Date.now();
    send(server,{jsonrpc:'2.0',id,method:'tools/call',params:{name:'powershell-command',arguments:{command:'Get-Date',confirmed:true}}});
    durations[id]=t0;
    sent++;
  }
}

server.stdout.on('data',d=>{
  d.toString().trim().split(/\r?\n/).forEach(line=>{ if(!line) return; try{ const msg=JSON.parse(line); if(msg.id===1 && !started){ started=true; fireBatch(); }
    else if(msg.id>=1000){ const id=msg.id; const t1=Date.now(); const dur = t1 - durations[id]; durations[id]=dur; done++; if(msg.error) errors++; if(done%50===0) process.stderr.write(`Progress: ${done}/${REQUESTS}\n`); if(done===REQUESTS){ finish(); } else fireBatch(); }
  }catch{} });
});

send(server,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'stress',version:'1.0.0'}}});

function finish(){
  const endTime=Date.now();
  const durs = durations.filter(v=>typeof v==='number');
  durs.sort((a,b)=>a-b);
  const pct = p=> durs[Math.min(durs.length-1, Math.floor(p/100*durs.length))];
  const stats = {
    timestamp: new Date().toISOString(),
    requests: REQUESTS,
    concurrency: CONCURRENCY,
    totalMs: endTime-startTime,
    rps: REQUESTS/((endTime-startTime)/1000),
    errors,
    latency: {
      min: durs[0],
      p50: pct(50),
      p90: pct(90),
      p95: pct(95),
      p99: pct(99),
      max: durs[durs.length-1]
    }
  };
  fs.writeFileSync(outfile, JSON.stringify(stats,null,2));
  console.log('Stress test complete => '+outfile); 
  console.log(JSON.stringify(stats,null,2));
  // fetch server-stats for correlation
  send(server,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'server-stats',arguments:{}}});
}

// capture server-stats output then exit
server.stdout.on('data',d=>{ d.toString().trim().split(/\r?\n/).forEach(line=>{ try{ const m=JSON.parse(line); if(m.id===2 && m.result){ fs.writeFileSync(path.join(OUTDIR,`server-stats-${stamp}.json`), m.result.content[0].text); server.kill(); } }catch{} }); });
