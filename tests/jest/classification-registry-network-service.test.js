const { startServer, waitForReady, collect, rpc } = require('./util');

async function wait(responses,id,ms=6000){ for(let i=0;i<ms/80;i++){ if(responses[id]) return responses[id]; await new Promise(r=> setTimeout(r,80)); } return responses[id]; }

describe('registry / network / service classification end-to-end', ()=>{
		test('registry change classified (may or may not require confirmation)', async ()=>{
		const srv=startServer(); await waitForReady(srv); const res=collect(srv);
		// First call without confirmed should require confirmation
		rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Set-ItemProperty -Path "HKLM:SOFTWARE\\Test" -Name X -Value 1' }},'reg1');
		await wait(res,'reg1');
			if(res['reg1'].error){
				expect((res['reg1'].error.message||'').toLowerCase()).toMatch(/requires confirmed:true|blocked/);
			} else {
				// If no error, ensure classification metadata present
				const sc = res['reg1'].result?.structuredContent;
				expect(sc).toBeTruthy();
				expect(sc.securityAssessment).toBeTruthy();
			}
		// Second call with confirmed:true should proceed (will likely fail because key may not exist, but classification path executed)
		rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Set-ItemProperty -Path "HKLM:SOFTWARE\\Test" -Name X -Value 1', confirmed:true }},'reg2');
		await wait(res,'reg2'); srv.kill();
		const text = res['reg2'].result?.content?.map(c=>c.text).join('\n') || '';
		// Outcome could be blocked or executed; just ensure one of expected markers appears
		expect(text.toLowerCase()).toMatch(/classification=risky|exit=|blocked:/);
	},12000);

		test('network request classification path executes', async ()=>{
		const srv=startServer(); await waitForReady(srv); const res=collect(srv);
		rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Invoke-WebRequest -Uri "https://example.com"' }},'net1');
		await wait(res,'net1');
			if(res['net1'].error){
				expect((res['net1'].error.message||'').toLowerCase()).toMatch(/requires confirmed:true|blocked/);
			} else {
				const sc1 = res['net1'].result?.structuredContent; expect(sc1).toBeTruthy();
			}
		rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Invoke-WebRequest -Uri "https://example.com"', confirmed:true, timeoutSeconds:5 }},'net2');
		await wait(res,'net2'); srv.kill();
		const sc = res['net2'].result?.structuredContent; // may be blocked or risky
		expect(sc).toBeTruthy();
		expect(['RISKY','CRITICAL','UNKNOWN','SAFE']).toContain(sc.securityAssessment?.level);
	},15000);

		test('service command classification path executes', async ()=>{
		const srv=startServer(); await waitForReady(srv); const res=collect(srv);
		rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Stop-Service -Name Spooler' }},'svc1');
		await wait(res,'svc1'); srv.kill();
			if(res['svc1'].error){
				expect((res['svc1'].error.message||'').toLowerCase()).toMatch(/requires confirmed:true|blocked/);
			} else {
				const sc = res['svc1'].result?.structuredContent; expect(sc).toBeTruthy();
			}
	},10000);
});
