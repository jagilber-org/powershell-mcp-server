// Legacy test (pre-deterministic sampler). Marked skipped post capture-ps-sample tool introduction.
// Converted to CommonJS require & skipped to avoid ESM parsing in current Jest config.
const { spawn } = require('child_process');
const http = require('http');

function startServer(envExtra = {}) {
  const env = { ...process.env, MCP_CAPTURE_PS_METRICS: '1', METRICS_DEBUG: '1', MCP_DISABLE_SELF_DESTRUCT: '1', MCP_QUIET: '1', ...envExtra };
  const candidates = ['dist/server.js', 'dist/index.js'];
  const ps = spawn('node', [candidates[0]], { env });
  return ps;
}

function waitForLine(ps, matcher, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + matcher)), timeout);
    ps.stderr.on('data', d => {
      const s = d.toString();
      if (matcher.test(s)) { clearTimeout(t); resolve(s); }
    });
  });
}

function callTool(ps, id, command) {
  const req = { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'run_powershell', arguments: { command, confirmed: true } } };
  ps.stdin.write(JSON.stringify(req) + '\n');
}

function fetchJsonOnce(path, port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchJsonMulti(path, detectedPort) {
  const tried = new Set();
  const ports = [detectedPort, ...Array.from({ length: 10 }, (_, i) => 9090 + i)];
  for (const p of ports) {
    if (p == null || tried.has(p)) continue; tried.add(p);
    try {
      const js = await fetchJsonOnce(path, p);
      // basic shape sanity
      if (js && typeof js === 'object' && 'totalCommands' in js) return js;
    } catch { /* ignore */ }
  }
  throw new Error('Unable to fetch metrics json from any candidate port: ' + [...tried].join(','));
}

test.skip('aggregates ps metrics when feature flag enabled (replaced by deterministic tests)', async () => {
  const server = startServer();
  let detectedPort = null;
  try {
    const line = await waitForLine(server, /HTTP server listening on http:\/\/127\.0\.0\.1:(\d+)/);
    const m = line.match(/HTTP server listening on http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) detectedPort = Number(m[1]);

    // Issue a burst of commands to ensure multiple sentinel samples
    const cmds = [
      'Get-Date',
      'Get-Process | Select-Object -First 1',
      'Write-Output "diag-loop"',
      'Write-Output "diag-loop"',
      'Get-Location'
    ];
    let id = 1;
    for (const c of cmds) callTool(server, id++, c);
    // Additional rapid fire to push sample count
    for (let i = 0; i < 5; i++) callTool(server, id++, 'Write-Output "diag-loop"');

    await new Promise(r => setTimeout(r, 3000));

    // First snapshot attempt
    let snap = await fetchJsonMulti('/api/metrics', detectedPort);
    if (!('psSamples' in snap) || snap.psSamples === 0) {
      // more commands then retry
      for (let i = 0; i < 5; i++) callTool(server, id++, 'Write-Output "diag-loop"');
      await new Promise(r => setTimeout(r, 2500));
      snap = await fetchJsonMulti('/api/metrics', detectedPort);
    }
    expect(snap.psSamples).toBeGreaterThan(0);
    expect(snap.psCpuSecAvg).toBeDefined();
    expect(snap.psWSMBAvg).toBeDefined();
  } finally {
    server.kill();
  }
}, 30000);
