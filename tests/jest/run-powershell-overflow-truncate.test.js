const { startServer, waitForReady, collect, rpc } = require('./util');

describe('run-powershell overflow truncate strategy', ()=>{
  test('env override to truncate applied', async ()=>{
    const srv = startServer({ MCP_OVERFLOW_STRATEGY: 'truncate' }); await waitForReady(srv); const res = collect(srv);
    const cmd = "1..10000 | % { 'ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890' }";
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:cmd, confirmed:true, timeout:20 }},'trunc');
    for(let i=0;i<140;i++){ if(res['trunc']) break; await new Promise(r=> setTimeout(r,110)); }
    srv.kill();
    const msg = res['trunc']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    expect(structured.overflow).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.overflowStrategy).toBe('truncate');
    expect(structured.reason).toBe('output_overflow');
    // In truncate mode we don't force-kill early; exitCode should generally be 0
    // but allow other codes if PowerShell ended differently
    expect(typeof structured.exitCode === 'number').toBe(true);
  }, 30000);
});