const { startServer, waitForReady, collect, request } = require('./util');

describe('learn tool', () => {
  test('list action returns candidates array (may be empty)', async () => {
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
    const list = await request(srv, responses, 'tools/call', { name:'learn', arguments:{ action:'list', limit:5 }}, 'learn');
    expect(list).toBeTruthy();
    const text = list.result?.content?.[0]?.text || '';
    expect(text).toMatch(/candidates/);
    srv.kill();
  },6000);
});
