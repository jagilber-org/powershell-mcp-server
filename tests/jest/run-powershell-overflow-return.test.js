const { startServer, waitForReady, collect, rpc } = require('./util');

// This test exercises the default overflow 'return' strategy (no MCP_OVERFLOW_STRATEGY set)
// It expects an early response with reason=output_overflow, overflowStrategy=return, exitCode 137.

describe('run-powershell overflow return strategy', ()=>{
  test('immediate return on large output', async ()=>{
  delete process.env.MCP_OVERFLOW_STRATEGY; // ensure default
  const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    // Generate large output quickly (>512KB): repeat long line many times
    const cmd = "1..12000 | % { 'ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890' }";
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:cmd, confirmed:true, timeoutSeconds:20 }},'ret');
    for(let i=0;i<80;i++){ if(res['ret']) break; await new Promise(r=> setTimeout(r,120)); }
    srv.kill();
    const msg = res['ret']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    expect(structured.overflow).toBe(true);
    expect(structured.overflowStrategy).toBe('return');
    expect(structured.reason).toBe('output_overflow');
    expect(structured.exitCode === 137 || structured.exitCode === (137|0)).toBe(true);
    expect(structured.truncated).toBe(true);
  }, 30000);
});


