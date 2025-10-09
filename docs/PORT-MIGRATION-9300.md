# Metrics Port Migration: 9090 → 9300

**Date**: 2025-10-09  
**Reason**: Windows dynamic port exclusion range 9072-9171 blocked ports 9090-9100

## Problem

Windows reserves port range **9072-9171** (likely due to Hyper-V/WSL2), which includes the previous default metrics port 9090. This caused all port binding attempts in that range to fail with `EACCES` (permission denied).

## Solution

1. **Changed default port from 9090 to 9300** (outside reserved range)
2. **Increased port scan range from 10 to 50 ports** (more buffer to find available ports)
3. **Added EACCES handling** to port scanning logic (previously only handled EADDRINUSE)

## Changes Made

### Code Changes
- `src/metrics/httpServer.ts`:
  - Default port: `9090` → `9300`
  - Scan range: `10` → `50`
  - Error handling: Added `EACCES` to retry conditions

### Configuration Updates
- Global MCP config: `C:\Users\jagilber\AppData\Roaming\Code - Insiders\User\mcp.json`
  - `METRICS_PORT: "9090"` → `"9300"`
- Local workspace config: `.vscode\mcp.json`
  - `METRICS_PORT: "9091"` → `"9300"`

### Documentation Updates
- `docs/FLAGS.md`:
  - Updated default port references: `9090` → `9300`
  - Updated scan max: `10` → `50`
- `tests/exercise-events.mjs`: Updated default port in comments and code
- `tests/ps-metrics-aggregation.test.js`: Updated port range
- `tests/jest/attempt-events.test.js`: Updated scan range to 9300-9350
- `tests/jest/capture-ps-sample.test.js`: Updated hardcoded port

## Windows Port Exclusion Ranges (as of 2025-10-09)

```
9072  - 9171   ← BLOCKED (includes old 9090-9100)
9172  - 9271   ← BLOCKED
9272  - 48576  ← SAFE (huge range - recommended)
48577+         ← Various dynamic exclusions
```

## Dashboard Access

After reload, the metrics dashboard will be available at:
- **http://127.0.0.1:9300/dashboard** (or next available port in range)

The server will automatically scan from port 9300 upward (up to 50 ports) until it finds an available port.

## Verification

To check what port was actually bound:
```powershell
# Look for the metrics server log line:
# [METRICS] HTTP server listening on http://127.0.0.1:<PORT>
```

To verify Windows port exclusions haven't changed:
```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

## Backward Compatibility

If `METRICS_PORT` is still set to 9090 in a config:
1. Server will attempt 9090 (fail with EACCES)
2. Automatically scan upward and find port 9300 or higher
3. Log each failed attempt until successful bind

**Recommendation**: Update configs to 9300 to avoid scanning delay.
