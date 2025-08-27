const { startServer, waitForReady, collect, rpc } = require('./util');

describe('health tool', ()=>{
  test('returns snapshot with uptime and memory', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'health', arguments:{} },'h');
    for(let i=0;i<60;i++){ if(res['h']) break; await new Promise(r=> setTimeout(r,100)); }
    srv.kill();
    const msg = res['h']; expect(msg).toBeTruthy();
    const structured = msg.result?.structuredContent || {};
    const primary = (structured && Object.keys(structured).length) ? structured : safeJson(msg.result?.content?.[0]?.text || '');
    expect(typeof primary.uptimeSec).toBe('number');
    expect(primary.memory && typeof primary.memory.rss === 'number').toBe(true);
    expect(primary.config && typeof primary.config.timeoutMs === 'number').toBe(true);
  }, 12000);
});

function safeJson(t){ try { return JSON.parse(t); } catch { return {}; } }
