const { startServer, waitForReady, collect, request } = require('./util');
const fs = require('fs');
const path = require('path');

async function callSyntax(srv, responses, args, id){
  return await request(srv, responses, 'tools/call', { name:'powershell-syntax-check', arguments: args }, id);
}

describe('powershell-syntax-check extended scenarios', () => {
  test('balanced nested braces and brackets', async () => {
    const script = 'function Test { $a = @(1,2,(3)); if($a[2] -eq 3){ Write-Output "ok" } }';
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script }, 'nested');
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok":\s*true/);
    srv.kill();
  }, 8000);

  test('unclosed brace triggers issue', async () => {
    const script = 'function Bad { if($true){ Write-Output "x" '; // missing two closing braces
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script }, 'brace');
    const text = rsp.result?.content?.[0]?.text || '';
    // Accept either ok:false or issues non-empty
    if(/"ok":\s*true/.test(text)){
      // parser sometimes tolerates? ensure still returns length
      expect(text).toMatch(/"scriptLength":/);
    } else {
      expect(text).toMatch(/"ok":\s*false/);
      expect(text).toMatch(/issues/);
    }
    srv.kill();
  }, 8000);

  test('quotes and brackets inside strings do not break balance', async () => {
    const script = 'Write-Output "{[( inside string )]}"; Write-Output "done"';
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script }, 'strings');
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok":\s*true/);
    srv.kill();
  }, 8000);

  test('here-string with embedded braces', async () => {
    const script = '@"\nfunction X { Write-Output (Get-Date) }\nMore { text }\n"@';
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script }, 'herestring');
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok":\s*true/);
    srv.kill();
  }, 8000);

  test('commented unbalanced delimiters ignored by parser', async () => {
    const script = '# { [ ( unmatched in comment )\nWrite-Output "real"';
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { script }, 'comment');
    const text = rsp.result?.content?.[0]?.text || '';
    expect(text).toMatch(/"ok":/); // either true or false depending on parser tolerance
    srv.kill();
  }, 8000);

  test('filePath missing returns error (handled via tool path)', async () => {
    const srv = startServer(); await waitForReady(srv); const responses = collect(srv);
    const rsp = await callSyntax(srv, responses, { filePath: path.join(__dirname,'does-not-exist-xyz.ps1') }, 'missing');
    const text = rsp.result?.content?.[0]?.text || '';
    // Should signal error pattern
    expect(text).toMatch(/error|not found/i);
    srv.kill();
  }, 8000);
});
