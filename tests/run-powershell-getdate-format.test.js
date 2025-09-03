// Duplicate legacy ESM-style test skipped; covered by jest variant in tests/jest/
// Converted to CommonJS require and skipped to avoid parser issues.
const { spawn } = require('child_process');

function startServer(extraEnv={}){
  const env = { ...process.env, MCP_DISABLE_SELF_DESTRUCT:'1', MCP_QUIET:'1', ...extraEnv };
  const ps = spawn('node', ['dist/server.js'], { env });
  return ps;
}

function collect(ps){
  return new Promise((resolve)=>{
    let stderr='';
    ps.stderr.on('data', d=> stderr+=d.toString());
    setTimeout(()=>{ ps.kill(); resolve({stderr}); }, 1500);
  });
}

test.skip('Get-Date -Format o not blocked by format regex (duplicate)', async()=>{
  const ps = startServer();
  const { stderr } = await collect(ps);
  expect(stderr).not.toMatch(/Blocked OS pattern: \\bformat/);
});
