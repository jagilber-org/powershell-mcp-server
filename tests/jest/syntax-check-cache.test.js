const { startServer, waitForReady, collect, request } = require('./util');

async function callSyntax(proc, responses, args, id){
  return await request(proc, responses, 'tools/call', { name:'powershell-syntax-check', arguments: args }, id, 3000);
}

function parseResult(msg){
  const text = msg?.result?.content?.[0]?.text || '';
  let json = null; try { json = JSON.parse(text); } catch { /* ignore */ }
  return { text, json };
}

describe('powershell-syntax-check cache & flags', () => {
  test('forced fallback via PWSH_SYNTAX_FORCE_FALLBACK=1', async () => {
    const srv = startServer({ PWSH_SYNTAX_FORCE_FALLBACK: '1' }); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script:'Write-Output "hi"' }, 'ffb');
    const { json, text } = parseResult(rsp);
    expect(text).toMatch(/"ok"/);
    if(json){ expect(json.parser).toBe('fallback'); }
    srv.kill();
  }, 8000);

  test('cache hit on second identical script', async () => {
    const script = 'Write-Output "cache-test"';
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const first = await callSyntax(srv, responses, { script }, 'c1');
    const { json: j1 } = parseResult(first);
    expect(j1 && j1.cacheHit).not.toBe(true); // first should not be cache hit
    const second = await callSyntax(srv, responses, { script }, 'c2');
    const { json: j2, text: t2 } = parseResult(second);
    expect(t2).toMatch(/"ok"/);
    if(j2){ expect(j2.cacheHit).toBe(true); }
    srv.kill();
  }, 10000);

  test('analyzer flag surfaces analyzerAvailable field', async () => {
    const srv = startServer({ PWSH_SYNTAX_ANALYZER: '1' }); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script:'Write-Output "ana"' }, 'ana');
    const { json, text } = parseResult(rsp);
    // We at least expect analyzerAvailable to appear (true if module installed, false otherwise)
    expect(text).toMatch(/analyzerAvailable/);
    if(json && json.analyzerAvailable){
      expect(Array.isArray(json.analyzerIssues)).toBe(true);
    }
    srv.kill();
  }, 12000);
});
