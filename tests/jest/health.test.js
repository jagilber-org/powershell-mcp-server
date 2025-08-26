const { startServer, waitForReady, collect, rpc } = require('./util');

describe('health tool', ()=>{
  test('returns snapshot with uptime and memory', async ()=>{
    const srv = startServer(); await waitForReady(srv); const res = collect(srv);
    rpc(srv,'tools/call',{ name:'health', arguments:{} },'h');
    for(let i=0;i<40;i++){ if(res['h']) break; await new Promise(r=> setTimeout(r,80)); }
    srv.kill();
    const msg = res['h']; expect(msg).toBeTruthy();
    const text = msg.result?.content?.[0]?.text || '';
    const json = JSON.parse(text);
    expect(typeof json.uptimeSec).toBe('number');
    expect(json.memory && typeof json.memory.rss === 'number').toBe(true);
    expect(json.config && typeof json.config.timeoutMs === 'number').toBe(true);
  }, 10000);
});