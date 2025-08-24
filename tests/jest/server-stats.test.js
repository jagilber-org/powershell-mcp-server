const { startServer, waitForReady, collect, request } = require('./util');

describe('server-stats tool', () => {
  test('returns metrics snapshot JSON', async () => {
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
    const list = await request(srv, responses, 'tools/list', {}, 'list');
    expect(list?.result?.tools?.length).toBeGreaterThan(0);
    const stats = await request(srv, responses, 'tools/call', { name:'server-stats', arguments:{} }, 'stats');
    expect(stats).toBeTruthy();
    const text = stats.result?.content?.[0]?.text || '';
    expect(text).toMatch(/totalCommands/);
    srv.kill();
  }, 6000);
});
