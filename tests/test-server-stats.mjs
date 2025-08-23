#!/usr/bin/env node
import { spawn } from 'child_process';

function send(req, proc) { proc.stdin.write(JSON.stringify(req)+'\n'); }

const server = spawn('node',['dist/server.js'], {stdio:['pipe','pipe','pipe']});
server.stderr.on('data', d=>process.stderr.write(d));
server.stdout.on('data', d=>{
  d.toString().trim().split(/\r?\n/).forEach(line=>{
    if(!line) return; try { const msg = JSON.parse(line); if(msg.id===1){ send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}, server);} if(msg.id===2){ send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'server-stats',arguments:{}}}, server);} if(msg.id===3){ console.log('SERVER-STATS RESPONSE'); console.log(msg.result.content[0].text); server.kill(); }} catch{} });
});

send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'stats-test',version:'1.0.0'}}}, server);
