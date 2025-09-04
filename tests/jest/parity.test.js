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
  // Minimal core surface intentionally excludes admin tools like threat-analysis and learn
  for(const required of ['run_powershell','server_stats','help','powershell_syntax_check','working_directory_policy','emit_log']){
      expect(names).toContain(required);
    }
    expect(new Set(names).size).toBe(names.length);
  },6000);
});


