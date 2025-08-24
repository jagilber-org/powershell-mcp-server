const { startServer, waitForReady, collect, request } = require('./util');

describe('tool parity', () => {
  test('tool list contains required core tools and no duplicates', async () => {
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
    const list = await request(srv, responses, 'tools/list', {}, 'list');
    srv.kill();
    expect(list).toBeTruthy();
    const tools = list.result?.tools || [];
    const names = tools.map(t=> t.name);
    for(const required of ['run-powershell','server-stats','threat-analysis','help','powershell-syntax-check','working-directory-policy','learn']){
      expect(names).toContain(required);
    }
    expect(new Set(names).size).toBe(names.length);
  },6000);
});

