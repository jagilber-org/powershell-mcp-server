# Runtime Flags & Environment Variables

Comprehensive list of CLI flags and environment variables recognized by the PowerShell MCP Server (master branch, Aug 2025).

## CLI Flags (Node entrypoints)

Unless noted, flags apply when launching via `node dist/server.js` or the packaged CLI `powershell-mcp-server`.

| Flag | Alias | Description | Side Effects / Env Bridge |
|------|-------|-------------|----------------------------|
| `-k, --key <key>` | — | Sets authentication key used to require `key` param on initialize / tool calls. | Sets `MCP_AUTH_KEY` in-process. |
| `--metrics-port <port>` | — | Preferred starting port for metrics HTTP server (scans upward if busy). Default 9090. | Sets `METRICS_PORT`. |
| `--no-metrics` | — | Disables in-memory metrics registry & dashboard. | Forces `cfg.metrics.enable=false`. |
| `--dump-config` | — | Prints merged runtime configuration JSON then exits. | No server start. |
| `--dry-run` | — | Validates configuration & exits (health check for deployment). | No server start. |
| `--framer-stdio` | — | Start in framed Content-Length transport mode (legacy SDK compatibility). | Bypasses legacy newline JSON path. |
| `--framer-debug` | — | Verbose framing logs (header/body length, hex preview). | Sets / checks `MCP_FRAMER_DEBUG`. |
| `--minimal-stdio` | — | Launch reduced feature set minimal stdio server (diagnostics). | Often forces `confirmed:true`. |
| `--disable-self-destruct` | — | (Planned / may map to env) Disable internal PowerShell self-destruct timer. | Equivalent to `MCP_DISABLE_SELF_DESTRUCT=1` if implemented. |
| `--enable-self-destruct` | — | Re-enable timer after prior disable. | Unsets `MCP_DISABLE_SELF_DESTRUCT`. |
| `--quiet` | — | Suppress verbose startup banners. | Intended tie-in to `MCP_QUIET=1` (future). |

Note: Some flags (`--minimal-stdio`, `--disable-self-destruct`, etc.) are referenced in docs / roadmap; if not yet parsed in `cli.ts` they are available via environment variables instead.

## Environment Variables

| Variable | Description | Default / Range | Module(s) Consuming |
|----------|-------------|-----------------|---------------------|
| `MCP_AUTH_KEY` | Authentication key required by clients (`key`). | Unset (no auth) | `server.ts`, `cli.ts`, enterprise vscode servers |
| `MCP_DISABLE_SELF_DESTRUCT` | Disable internal injected 124 exit timer for PowerShell executions. | `0` (unset) | `runPowerShell.ts` |
| `MCP_CAPTURE_PS_METRICS` | Enable periodic & per-exec PowerShell CPU/WS sampling (fallback & sampler). | `0` | `runPowerShell.ts`, `metrics/httpServer.ts` |
| `MCP_PS_SENTINEL` | Enable in-process stderr sentinel emission for CPU/WS (lower overhead). | `0` | `runPowerShell.ts` |
| `MCP_OVERFLOW_STRATEGY` | Output overflow handling: `return`, `truncate`, `terminate`. | `return` | `runPowerShell.ts` |
| `MCP_DISABLE_ATTEMPT_PUBLISH` | Suppress publishing of early attempt (blocked / confirmed-required) events. | `0` | `metrics/publisher.ts` |
| `METRICS_DEBUG` | Verbose metrics registry & baseline PS sample logs. | `false` | `registry.ts`, `runPowerShell.ts`, `httpServer.ts` |
| `MCP_FRAMER_DEBUG` | Verbose output for framing transport (if framed mode). | `0` | `server.ts` (framer mode) |
| `MCP_FRAMED_STDIO` | Force framed stdio transport (Content-Length). | `0` | `server.ts` |
| `METRICS_PORT` | Starting port for metrics HTTP server. | `9090` | `httpServer.ts`, `cli.ts` |
| `METRICS_PORT_SCAN_MAX` | Max additional ports to try if starting port busy. | `10` | `httpServer.ts` |
| `MCP_METRICS_ENABLE` | Override metrics enable in config (`true`/`false`). | Config default | `config.ts` |
| `MCP_ENFORCE_AUTH` | Force auth required even if config disables. | Config default | `config.ts` |
| `UNKNOWN_LEARN_SECRET` | Secret for securing unknown learning endpoints. | `dev-secret` | `learning.ts` |
| `START_MODE` | Alternate entry behavior (e.g., `health`). | Unset | `index.ts` |
| `PWSH_EXE` | Explicit PowerShell Core executable path for detection override. | Probe search | `core/shellDetection.ts` |
| `MCP_QUIET` | Suppress verbose startup logs (planned). | `0` | (future main/server) |

## Added (Sept 2025)

| Variable | Description | Default / Range | Module(s) |
|----------|-------------|-----------------|-----------|
| `PWSH_SYNTAX_FORCE_FALLBACK` | Force legacy delimiter fallback parser for all syntax checks (diagnostics/perf baselining). | `0` | `pwshSyntax.ts` |
| `PWSH_SYNTAX_ANALYZER` | Enable optional PSScriptAnalyzer pass (surfaces `analyzerIssues` & `analyzerAvailable`). | `0` | `pwshSyntax.ts` |

`cacheHit` field appears in `structuredContent` when a script hash lookup returns cached parse results.

### Derived / Internal Counters (exposed via `/api/metrics`)

| Field | Meaning |
|-------|---------|
| `attemptCommands` | Total blocked + confirmed-required attempts (duration 0ms) |
| `attemptConfirmedRequired` | Attempts needing confirmed (RISKY/UNKNOWN) |
| `executionCommands` | Executions with real duration > 0ms |
| `confirmedExecutions` | Executions of RISKY/UNKNOWN with confirmed |
| `confirmedConversion` | confirmedExecutions / attemptConfirmedRequired |
| `psSamples` | Number of PowerShell process metric samples captured |
| `psCpuSecAvg` | Average CPU seconds per sample |
| `psWSMBAvg` | Average Working Set MB per sample |

### Notes

- Sentinel path (`MCP_PS_SENTINEL=1`) preferred over fallback sampling for lower overhead.
- Zero-duration attempts excluded from latency aggregates (`averageDurationMs`, `p95DurationMs`).
- `MCP_DISABLE_ATTEMPT_PUBLISH=1` can be used to simulate pre-feedback behavior without reverting commits.

---
Generated automatically (manual review recommended for future changes).
