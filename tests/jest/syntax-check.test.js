const { startServer, waitForReady, collect, request } = require('./util');

describe('powershell-syntax-check tool', () => {
  test('validates simple script', async () => {
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
    const syntax = await request(srv, responses, 'tools/call', { name:'powershell-syntax-check', arguments:{ script:'Get-Date' }}, 'syntax');
    expect(syntax).toBeTruthy();
    const text = syntax.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok": true|ok/);
    srv.kill();
  },5000);
});
