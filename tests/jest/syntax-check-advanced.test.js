const { startServer, waitForReady, collect, request, rpc } = require('./util');
const fs = require('fs');
const path = require('path');

async function callLegacy(proc, responses, args, id){
  return await request(proc, responses, 'tools/call', { name:'powershell-syntax-check', arguments: args }, id, 3000);
}

async function callMcp(proc, responses, args, id){
  // Use MCP style list to ensure syntax-check tool exists then call it
  await request(proc, responses, 'tools/list', {}, 'list-'+id, 1500);
  return await request(proc, responses, 'tools/call', { name:'syntax-check', arguments: args }, id, 3000);
}

describe('syntax-check advanced validation', () => {
  test('multiple distinct errors produce issues array (likely non-empty)', async () => {
    const script = 'function A { Write-Output (Get-Date }\nfunction B { Write-Output "Unclosed';
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callLegacy(srv, responses, { script }, 'multi');
    const txt = rsp.result?.content?.[0]?.text || '';
    expect(txt).toMatch(/"scriptLength":/);
    expect(txt).toMatch(/issues/);
    srv.kill();
  }, 9000);

  test('MCP tool name syntax-check may be unavailable in legacy newline protocol', async () => {
    const script = 'Write-Output "hi"';
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const legacy = await callLegacy(srv, responses, { script }, 'leg');
    const lt = legacy.result?.content?.[0]?.text || '';
    expect(lt).toMatch(/"ok":\s*true/);
    const mcp = await callMcp(srv, responses, { script }, 'mcp');
    const mt = mcp.result?.content?.[0]?.text || '';
    // Accept either success or unknown tool error depending on server mode
    if(/Unknown tool: syntax-check/.test(mt)){
      expect(mt).toMatch(/Unknown tool/);
    } else {
      expect(mt).toMatch(/"ok":\s*true/);
    }
    srv.kill();
  }, 9000);

  test('very large script (5k lines) parses within time budget', async () => {
    const script = ('Write-Output "line"\n').repeat(5000);
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const t0 = Date.now();
    const rsp = await callLegacy(srv, responses, { script }, 'big');
    const dur = Date.now() - t0;
    const txt = rsp.result?.content?.[0]?.text || '';
    expect(txt).toMatch(/"scriptLength":/);
    expect(dur).toBeLessThan(6000);
    srv.kill();
  }, 15000);

  test('fallback path - missing script returns structured error', async () => {
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callLegacy(srv, responses, { }, 'noargs');
    const txt = rsp.result?.content?.[0]?.text || '';
    expect(txt).toMatch(/error/i);
    srv.kill();
  }, 6000);
});
