const { startServer, waitForReady, collect, rpc } = require('./util');

describe('run-powershell tool', ()=>{
  test('executes safe command with confirmation for unknown classification', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv); rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "jest-ok"', confirmed:true }},'run');
  for(let i=0;i<60;i++){ if(res['run']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['run'];
    expect(msg).toBeTruthy();
    const text = msg.result?.content?.[0]?.text || '';
    expect(text).toMatch(/jest-ok/);
  },8000);

  test('blocked pattern prevented', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv); rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Invoke-Expression "Write-Output blocked"' }},'blocked');
  for(let i=0;i<60;i++){ if(res['blocked']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['blocked'];
    expect(msg).toBeTruthy();
    const text = msg.result?.content?.[0]?.text || '';
    expect(text.toLowerCase()).toMatch(/blocked/);
  },8000);
  
  test('timeout value interpreted as seconds', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Start-Sleep -Seconds 1; Write-Output "sleep-done"', confirmed:true, timeoutSeconds:2 }},'sleep');
    for(let i=0;i<40;i++){ if(res['sleep']) break; await new Promise(r=> setTimeout(r,100)); }
    srv.kill();
    const msg = res['sleep'];
    expect(msg).toBeTruthy();
    const text = msg.result?.content?.[0]?.text || '';
    expect(text).toMatch(/sleep-done/);
  },12000);

  test('watchdog or internal self-destruct resolves hang beyond timeout', async ()=>{
    // Use a PowerShell command that waits on an event that never occurs; implement via Wait-Event with timeout longer than our tool timeout
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    // Command: waits 15s; tool timeout 2s => should trigger timeout + watchdog (watchdog may take a couple extra seconds)
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "pre"; Wait-Event -SourceIdentifier never-happens -Timeout 15; Write-Output "post"', confirmed:true, timeoutSeconds:2 }},'hang');
    for(let i=0;i<120;i++){ if(res['hang']) break; await new Promise(r=> setTimeout(r,250)); }
    srv.kill();
    const msg = res['hang'];
    expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
  // Either external timeout (timedOut true) OR internal self-destruct exit code 124 must occur
  expect(structured.timedOut || structured.exitCode === 124).toBe(true);
  // watchdogTriggered may be true or false depending on path
  }, 35000);

  test('large output is truncated and flagged', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    // Produce > maxLines & maxKB output (assuming defaults) by repeating pattern
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'1..6000 | % { "LINE$_" }', confirmed:true, timeout:8 }},'big');
    for(let i=0;i<120;i++){ if(res['big']) break; await new Promise(r=> setTimeout(r,100)); }
    srv.kill();
    const msg = res['big'];
    expect(msg).toBeTruthy();
  const structured = msg.result?.structuredContent || {};
    expect(structured.truncated||structured.overflow).toBe(true);
    expect(structured.chunks?.stdout?.length).toBeGreaterThan(0);
  },20000);

  test('overflow kill triggers overflow flag and chunks present', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    // Generate >512KB output (default maxOutputKB) quickly: 9000 lines * 120 chars ~ >1MB
    const cmd = "1..9000 | % { 'ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890' }";
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:cmd, confirmed:true, timeoutSeconds:15 }},'overflowBig');
    for(let i=0;i<160;i++){ if(res['overflowBig']) break; await new Promise(r=> setTimeout(r,120)); }
    srv.kill();
    const msg = res['overflowBig']; expect(msg).toBeTruthy();
  const structured = msg.result?.structuredContent || {};
    expect(structured.overflow).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.chunks?.stdout?.length).toBeGreaterThan(0);
  },30000);

  test('command length overflow rejected', async ()=>{
    const srv=startServer(); await waitForReady(srv); const res=collect(srv);
    const longCmd = 'Write-Output "' + 'X'.repeat(11000) + '"';
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command: longCmd, confirmed:true }},'overflow');
    for(let i=0;i<60;i++){ if(res['overflow']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['overflow'];
    expect(msg).toBeTruthy();
    const txt = msg.error?.message || msg.result?.content?.[0]?.text || '';
    expect(txt).toMatch(/exceeds limit/i);
  },15000);
});



