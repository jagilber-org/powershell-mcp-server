const { startServer, waitForReady, collect, request } = require('./util');

function bigString(len){ return 'X'.repeat(len); }

describe('emit-log hardening', () => {
  test('truncates and redacts secrets', async () => {
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
  const secretMsg = 'apiKey=12345 password=hunter2 some normal text ' + bigString(3000);
    const res = await request(srv, responses, 'tools/call', { name:'emit-log', arguments:{ message: secretMsg }}, 'elog', 1500);
    expect(res).toBeTruthy();
    const text = res.result?.content?.[0]?.text || '';
    expect(text).toContain('stored');
  expect(text).not.toContain('hunter2');
    expect(text.toLowerCase()).toContain('truncated');
    srv.kill();
  },8000);
});

