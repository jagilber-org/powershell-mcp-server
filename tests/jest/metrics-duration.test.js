const { startServer, waitForReady, collect, rpc, request, fetchMetrics } = require('./util');

// This test ensures that real tool executions produce non-zero duration metrics
// and that zero-duration attempt events (blocked / confirmation required) do not
// drag averages to zero.

describe('metrics duration recording', () => {
  let srv; let responses;
  beforeAll(async () => {
    srv = startServer({ MCP_CAPTURE_PS_METRICS:'0' });
    await waitForReady(srv);
    responses = collect(srv);
  });
  afterAll(()=> { try { srv.kill(); } catch{} });

  test('records non-zero duration for server-stats and run-powershell', async () => {
    // Execute a fast non-PS tool
    const r1 = await request(srv, responses, 'tools/call', { name:'server-stats', arguments:{} }, 'dur1', 2000);
    expect(r1).toBeTruthy();
    // Execute a short PowerShell command
    const r2 = await request(srv, responses, 'tools/call', { name:'run-powershell', arguments:{ command:'Write-Output "hi"', confirmed:true, aiAgentTimeoutSec:2 } }, 'dur2', 4000);
    expect(r2).toBeTruthy();
    // Execute a blocked attempt (should not add positive duration)
    try { await request(srv, responses, 'tools/call', { name:'run-powershell', arguments:{ command:'Invoke-Expression "bad"' } }, 'dur3', 2000); } catch{}
    // Allow metrics server to aggregate
    await new Promise(r=> setTimeout(r, 600));
    const snap = await fetchMetrics();
    expect(snap.totalCommands).toBeGreaterThanOrEqual(2);
    // Average duration should be > 0 because of actual execution durations
    expect(snap.averageDurationMs).toBeGreaterThan(0);
  }, 10000);
});
