#!/usr/bin/env node
import { spawn } from 'child_process';

function send(proc, obj) { proc.stdin.write(JSON.stringify(obj)+'\n'); }

const server = spawn('node',['dist/server.js'],{stdio:['pipe','pipe','pipe']});
server.stderr.on('data', d=>process.stderr.write(d));
let responses=0, errors=0;
const total=15; // > burst to trigger limit
server.stdout.on('data', d=>{
  d.toString().trim().split(/\r?\n/).forEach(line=>{ if(!line) return; try { const m=JSON.parse(line); if(m.id===1){ // init done -> fire requests
      for(let i=0;i<total;i++){
        send(server,{jsonrpc:'2.0',id:100+i,method:'tools/call',params:{name:'powershell-command',arguments:{command:'Get-Date',confirmed:true}}});
      }
    } else if (m.id>=100 && m.id<100+total){
      responses++;
      if(m.error) errors++;
      if(responses===total){
        console.log('Rate limit test complete. errors='+errors+' responses='+responses);
        console.log(errors>0? '✅ Rate limiting engaged':'⚠️ Rate limiting not triggered');
        server.kill();
      }
    }
  } catch{} });
});

send(server,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'ratetest',version:'1.0.0'}}});
