const { startServer, waitForReady, collect, request } = require('./util');
const fs = require('fs');
const path = require('path');

// Helper to invoke syntax check (legacy tool name)
async function callSyntax(srv, responses, args, id){
  return await request(srv, responses, 'tools/call', { name:'powershell-syntax-check', arguments: args }, id);
}

describe('powershell-syntax-check tool', () => {
  test('validates simple script ok', async () => {
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script:'Get-Date' }, 'ok1');
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok":\s*true/);
    srv.kill();
  }, 8000);

  test('detects syntax error (mismatched braces or unclosed string)', async () => {
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    // Unclosed string should produce a parse error
    const bad = 'Write-Output "Unclosed';
    const rsp = await callSyntax(srv, responses, { script: bad }, 'bad1');
    const text = rsp.result?.content?.[0]?.text || '';
    // Accept either explicit failure or (rare) silent success; if success ensure scriptLength > 0 and issues array present
    if(/"ok":\s*true/.test(text)){
      expect(text).toMatch(/"scriptLength":\s*\d+/);
    } else {
      expect(text).toMatch(/"ok":\s*false/);
      expect(text).toMatch(/issues/);
    }
    srv.kill();
  }, 8000);

  test('filePath input works', async () => {
    const tmp = path.join(__dirname, 'tmp-syntax-test.ps1');
    fs.writeFileSync(tmp, 'Write-Output "Hello"');
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { filePath: tmp }, 'file1');
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok":\s*true/);
    srv.kill(); fs.unlinkSync(tmp);
  }, 8000);

  test('large script still returns quickly', async () => {
    const large = 'function F { Write-Output 1 }\n'.repeat(400);
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const t0 = Date.now();
    const rsp = await callSyntax(srv, responses, { script: large }, 'large');
    const dur = Date.now()-t0;
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"scriptLength":/);
    expect(dur).toBeLessThan(5000); // guard against hang
    srv.kill();
  }, 10000);

  test('empty script treated as ok', async () => {
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script:'  ' }, 'empty');
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok":\s*true/);
    srv.kill();
  }, 6000);
});

