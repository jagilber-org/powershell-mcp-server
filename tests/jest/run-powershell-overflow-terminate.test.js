const { startServer, waitForReady, collect, rpc } = require('./util');

describe('run-powershell overflow terminate strategy', ()=>{
	test('env override to terminate applied', async ()=>{
		const srv = startServer({ MCP_OVERFLOW_STRATEGY: 'terminate' }); await waitForReady(srv); const res = collect(srv);
		const cmd = "1..9000 | % { 'ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890' }";
		rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:cmd, confirmed:true, timeoutSeconds:15 }},'term');
		for(let i=0;i<140;i++){ if(res['term']) break; await new Promise(r=> setTimeout(r,110)); }
		srv.kill();
		const msg = res['term']; expect(msg).toBeTruthy();
		const structured = msg.result?.structuredContent || {};
		expect(structured.overflow).toBe(true);
		expect(structured.overflowStrategy).toBe('terminate');
		expect(structured.reason === undefined || structured.reason === 'output_overflow').toBe(true);
	}, 30000);
});

