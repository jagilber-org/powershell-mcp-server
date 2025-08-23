# PowerShell Per-Invocation Process Metrics (Experimental)

Feature flag: limits.capturePsProcessMetrics (env override MCP_CAPTURE_PS_METRICS=1)

When enabled, each run-powershell tool invocation appends a lightweight PowerShell snippet that emits a JSON sentinel containing CPU and Working Set metrics for the current PowerShell host process performing the command.

Sentinel shape (internal):

```json
{
  "__MCP_INTERNAL_PS_METRICS_v1": 1,
  "cpuTotalSeconds": 12.345,
  "wsMB": 42.0,
  "pmMB": 55.5,
  "handles": 123
}
```

Only cpuTotalSeconds and wsMB are currently surfaced per-row in the metrics dashboard (additional fields retained for potential future analysis). In addition, aggregated cards are shown after the first sample:

| Card | Source Field | Description |
|------|--------------|-------------|
| PS CPU AVG(s) | psCpuSecAvg | Mean CPU seconds per invocation |
| PS CPU P95(s) | psCpuSecP95 | 95th percentile CPU seconds |
| PS WS AVG(MB) | psWSMBAvg | Mean Working Set (resident) MB |
| PS WS P95(MB) | psWSMBP95 | 95th percentile Working Set MB |
| PS Samples | psSamples | Count of contributing invocations |

Snapshot example fragment:

```jsonc
{
  "psSamples": 12,
  "psCpuSecAvg": 0.37,
  "psCpuSecP95": 0.81,
  "psWSMBAvg": 88.4,
  "psWSMBP95": 101.2
}
```

## Enabling

Environment variable (takes precedence over config file):

PowerShell
$env:MCP_CAPTURE_PS_METRICS = 1

Or set in enterprise-config.json:
{
  "limits": { "capturePsProcessMetrics": true }
}

## Overhead

A Jest perf guard test (perf-psmetrics-baseline.test.js) executes a burst of 30 trivial commands with the flag off and on. The test asserts that enabling metrics does not introduce more than 25% slowdown in wall clock batch completion time. This is a coarse guardrail; adjust threshold as needed if future instrumentation changes.

## Disabling

Unset or set MCP_CAPTURE_PS_METRICS=0, or set capturePsProcessMetrics:false in config.

## Notes

- Metrics collection avoids additional external process launches (uses Get-Process inside the same PowerShell instance).
- Sentinel JSON is stripped from normal stdout prior to returning tool output to clients.
- If parsing fails, execution continues and metrics are simply omitted.
