const { startServer, waitForReady, collect, rpc } = require('./util');
const fs = require('fs');
const path = require('path');

describe('run-powershellscript file execution', ()=>{
  const tempFile = path.join(process.cwd(),'temp-alias-test.ps1');
  beforeAll(()=>{
    fs.writeFileSync(tempFile, 'Write-Output "file-alias-ok"');
  });
  afterAll(()=>{ try{ fs.unlinkSync(tempFile); }catch{} });

  test('executes scriptFile content', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershellscript', arguments:{ scriptFile: path.basename(tempFile), confirmed:true, workingDirectory: process.cwd() }},'fileRun');
    for(let i=0;i<60;i++){ if(res['fileRun']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['fileRun']; expect(msg).toBeTruthy();
    const text = msg.result?.content?.[0]?.text || '';
    expect(text).toMatch(/file-alias-ok/);
  },8000);
});
