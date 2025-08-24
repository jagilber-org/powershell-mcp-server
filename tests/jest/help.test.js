const { startServer, waitForReady, collect, request } = require('./util');

describe('help tool', () => {
  test('returns security help topic', async () => {
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
    const help = await request(srv, responses, 'tools/call', { name:'help', arguments:{ topic:'security' }}, 'help');
    expect(help).toBeTruthy();
    const text = help.result?.content?.[0]?.text || '';
    expect(text.toLowerCase()).toContain('security');
    srv.kill();
  },5000);
});
