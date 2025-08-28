const fs = require('fs');
const path = require('path');
const os = require('os');
const { startServer, waitForReady, collect, rpc } = require('./util');

describe('working-directory-policy tool', () => {
  test('enforces disallowed working directory', async () => {
    const srv = startServer();
    await waitForReady(srv);
    const responses = collect(srv);
    const allowed = path.join(process.cwd(), 'wd-allowed');
    if(!fs.existsSync(allowed)) fs.mkdirSync(allowed);
    // Set policy to only allow the new subfolder
    rpc(srv,'tools/call',{ name:'working-directory-policy', arguments:{ action:'set', enabled:true, allowedWriteRoots:[allowed] }},'set');
    // Attempt run outside allowed root (process.cwd())
    rpc(srv,'tools/call',{ name:'run-powershell', arguments:{ command:'Write-Output "wdtest"', workingDirectory: process.cwd(), confirmed:true }},'run');
    // Wait a bit
    await new Promise(r=> setTimeout(r,500));
    const run = responses['run'];
    srv.kill();
    expect(run).toBeTruthy();
    const text = run.result?.content?.[0]?.text || '';
    expect(text).toMatch(/Working directory outside allowed roots|InvalidRequest/);
  },7000);
});

