# PowerShell MCP Server (Enterprise Hardening / Minimal Core Aug 2025)

## Quick Start

```powershell
npm install
npm run build
npm run start:enterprise
```

> Deprecation: Legacy entry files `vscode-server-enterprise.ts` / `vscode-server.ts` are deprecated and excluded from the TypeScript build. Migrate any scripts invoking `dist/vscode-server-enterprise.js` to `dist/server.js` (preferred) or `dist/index.js`. The deprecated files will be removed in a future major release.

Optional auth:

```powershell
$env:MCP_AUTH_KEY = "your-strong-key"
npm run start:enterprise
```

## Available Tools (Core + Extended)

| Tool | Purpose | Key Arguments (selected) |
|------|---------|-------------------------|
| `emit-log` | Structured audit log entry | `message` |
| `learn` | Manage unknown → safe learning queue | `action`, `limit`, `minCount`, `normalized[]` |
| `working-directory-policy` | Get/set allowed roots enforcement | `action`, `enabled`, `allowedWriteRoots[]` |
| `server-stats` | Metrics snapshot & counts | `verbose` |
| `memory-stats` | Process memory (MB) | `gc` |
| `agent-prompts` | Retrieve prompt library sections | `category`, `format` (markdown/json) |
| `git-status` | Show repository status | `porcelain` |
| `git-commit` | Commit staged changes | `message` |
| `git-push` | Push current branch | `setUpstream` |
| `threat-analysis` | Unknown / threat tracking stats | — |
| `run-powershell` | Execute command / inline script (classified) | `command` / `script`, `workingDirectory`, `aiAgentTimeoutSec`, `confirmed`, adaptive params* |
| `run-powershellscript` | Execute inline or file content | `script` OR `scriptFile`, `workingDirectory`, timeout params, `confirmed` |
| `powershell-syntax-check` | Fast heuristic script check (no execution) | `script`, `filePath` |
| `ai-agent-tests` | Internal regression harness | `testSuite`, `skipDangerous` |
| `help` | Structured help topics | `topic` |

Adaptive timeout params (*): `progressAdaptive` (bool), `adaptiveExtendWindowMs`, `adaptiveExtendStepMs`, `adaptiveMaxTotalSec`.

Notes:

1. `RISKY` & `UNKNOWN` require `confirmed: true`.
2. `run-powershellscript` supports `scriptFile:"relative/or/absolute.ps1"` (read & inlined).
3. Blocked patterns (`Invoke-Expression`, forced destructive VCS, recursive quiet deletes) are rejected pre-exec.
4. Working directory enforcement (when enabled) rejects paths outside `allowedWriteRoots`.

## Security Model

Levels: SAFE â†’ RISKY â†’ DANGEROUS (reserved) â†’ CRITICAL â†’ BLOCKED â†’ UNKNOWN

| Level | Requires confirmed? | Executed? | Example | Category Sample |
|-------|---------------------|-----------|---------|-----------------|
| SAFE | No | Yes | `Get-ChildItem` | INFORMATION_GATHERING |
| RISKY | Yes | Yes | `git pull` | VCS_MUTATION |
| CRITICAL | N/A | No | `git reset --hard` | VCS_DESTRUCTIVE |
| BLOCKED | N/A | No | `Invoke-Expression` | SECURITY_THREAT |
| UNKNOWN | Yes | Yes | `foobar-tool --x` | UNKNOWN_COMMAND |

## First Call Execution Behavior

**✅ Commands that execute immediately (no `confirmed` needed):**

- **SAFE commands**: Pre-classified patterns like `Get-ChildItem`, `dir`, `git status`
- **Learned SAFE commands**: Previously unknown commands that were approved via learning system

**❌ Commands that require `confirmed: true` on first call:**

- **RISKY commands**: Pre-classified as potentially disruptive (e.g., `git commit`, `copy`)
- **UNKNOWN commands**: Any command not matching SAFE, RISKY, CRITICAL, or BLOCKED patterns

**🚫 Commands that never execute:**

- **BLOCKED commands**: Security threats like `Invoke-Expression`
- **CRITICAL commands**: Destructive operations like `git reset --hard`

**Key Point**: Once an UNKNOWN command is learned and approved, it becomes SAFE and will execute without `confirmed` on subsequent calls.

Alias & OS classification:
 
| Category | Examples |
|----------|----------|
| OS_READONLY | `dir`, `whoami`, `echo` |
| OS_MUTATION | `copy`, `move`, plain `del file.txt` |
| OS_DESTRUCTIVE (blocked) | `del /s /q`, `rd /s /q`, `format`, `shutdown` |
| VCS_READONLY | `git status`, `git diff` |
| VCS_MUTATION | `git commit`, `gh pr create` |
| VCS_DESTRUCTIVE | `git push --force`, `git clean -xfd` |

PowerShell Core preference: auto-detects `pwsh.exe` and falls back to `powershell.exe`. Override with `ENTERPRISE_CONFIG.powershell.executable`.

### Tool Hardening (New)

| Tool | Hardening Added | Limits / Behavior |
|------|-----------------|-------------------|
| emit-log | Secret redaction (`apiKey=`, `password=`, `secret=` patterns), control char stripping, length cap | `logging.maxLogMessageChars` (env: `MCP_MAX_LOG_CHARS`, default 2000). Truncated suffix `<TRUNCATED>` |
| agent-prompts | Category sanitization, secret fenced block redaction (```secret ...```), size cap, audit event | `limits.maxPromptBytes` (env: `MCP_MAX_PROMPT_BYTES`, default 50000) with `<!-- TRUNCATED -->` marker |

Secret fenced block example (will be redacted):

  ```secret
  Internal strategy text
  ```

Returned as:

  ```redacted
  [SECRET BLOCK REDACTED]
  ```

## Configuration (excerpt `enterprise-config.json` / minimal core `config.ts` defaults)

```jsonc
{
  "security": {
    "allowedWriteRoots": ["${TEMP}", "./sandbox"],
    "enforceWorkingDirectory": false,
    "additionalSafe": [],
    "additionalBlocked": [],
    "suppressPatterns": []
  },
  "rateLimit": { "enabled": true, "intervalMs": 5000, "maxRequests": 8, "burst": 12 },
  "limits": { "maxOutputKB": 128, "maxLines": 1000, "defaultTimeoutMs": 90000, "maxPromptBytes": 50000 },
  "logging": { "structuredAudit": true, "truncateIndicator": "<TRUNCATED>", "maxLogMessageChars": 2000 }
}
```

## Writing Commands

Request:
 
```json
{ "jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run-powershell","arguments":{"command":"Get-Date"}} }
```

Script file execution:
 
```json
{ "jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run-powershellscript","arguments":{"scriptFile":"scripts/sample.ps1","confirmed":true}} }
```

Add `"confirmed": true` for RISKY / UNKNOWN.

## Working Directory Policy

Argument: `workingDirectory` (optional string)

Behavior:

1. If omitted: process inherits the server's own current directory.
2. If provided: server resolves it via `fs.realpathSync` (canonical path; follows symlinks) and launches PowerShell with that as `cwd`.
3. If `security.enforceWorkingDirectory` = true: the resolved path MUST start with one of `security.allowedWriteRoots` (after variable expansion like `${TEMP}`). Otherwise the request is rejected with InvalidRequest.
4. If enforcement = false: any existing directory is accepted (still canonicalized); failures to resolve produce an error.

Security Rationale:

- Prevents directory escape / traversal when restricting file mutations to a sandbox.
- Symlink canonicalization blocks bypass via junctions / reparse points.

Error Modes:

| Condition | Error |
|-----------|-------|
| Directory does not exist | `Working directory not found` |
| Outside allowed roots (enforced) | `Working directory outside allowed roots` |

Response Field:

`workingDirectory` echoes the canonical path actually used (or is absent if none specified).

Notes:

- This parameter extends typical MCP tool arguments (not part of base protocol spec); clients MAY omit it safely.
- Allowed roots support `${TEMP}` token expansion and relative paths (resolved against server start directory).

## Output Truncation & Chunking

Chunk size: `limits.chunkKB` (default 64KB). Cumulative cap: `limits.maxOutputKB`. Lines cap: `limits.maxLines`.

Overflow flow (strategies):

| Env `MCP_OVERFLOW_STRATEGY` | Behavior | Process Handling | Response Extras |
|-----------------------------|----------|------------------|-----------------|
| (unset) or `return` | Default: immediate client feedback with partial data | Stop listeners, respond immediately (synthetic exitCode 137), then SIGTERM/SIGKILL in background | `overflow:true`, `truncated:true`, `overflowStrategy:"return"`, `reason:"output_overflow"`, `exitCode:137` |
| `terminate` | Aggressive stop | SIGTERM then (if `limits.hardKillOnOverflow`) SIGKILL after short delay | `overflow:true`, `truncated:true`, `overflowStrategy:"terminate"` |
| `truncate` | Passive: stop reading further output; allow natural completion or timeout | Removes data listeners; process continues | `overflow:true`, `truncated:true`, `overflowStrategy:"truncate"` |

General steps:

1. Collect chunks until caps exceeded.
2. Apply selected strategy.
3. Response flags `overflow:true`, `truncated:true` plus strategy metadata.

Execution response (core fields – augmented Aug 2025):
 
```jsonc
{
  "success": true,
  "exitCode": 0,
  "timedOut": false,
  "terminationReason": "completed",            // completed | timeout | killed | output_overflow
  "configuredTimeoutMs": 90000,
  "effectiveTimeoutMs": 90000,                  // > configured if adaptive extensions applied
  "adaptiveExtensions": 0,
  "adaptiveExtended": false,
  "adaptiveMaxTotalMs": 90000,
  "duration_ms": 1234,                          // high‑res rounded; min 1ms enforced for real execs
  "stdout": "preview",
  "stderr": "",
  "overflow": false,
  "overflowStrategy": "return",                // return | truncate | terminate
  "truncated": false,
  "totalBytes": 5120,
  "warnings": [],                               // deprecation & long-timeout notices
  "originalTimeoutSeconds": 90,
  "internalSelfDestruct": false,                // true if internal 124 exit
  "watchdogTriggered": false,
  "killEscalated": false,
  "killTreeAttempted": false,
  "securityAssessment": {
    "level": "SAFE",
    "category": "INFORMATION_GATHERING",
    "reason": "Safe pattern: ^Get-",
    "blocked": false,
    "requiresPrompt": false
  }
}
```

`timedOut: true` pairs with exit code 124 (internal self-destruct) or null (watchdog) and increments TIMEOUTS metric.

Mitigation tips for large output: narrow queries, use `Select-Object -First N`, filter early, or paginate across multiple calls.

## Timeouts & Resilience

External timeout enforced (default 90s). Internal self-destruct (exit 124) can be disabled with `MCP_DISABLE_SELF_DESTRUCT=1`. Adaptive mode (enable via `progressAdaptive:true`) opportunistically extends the external timeout when recent output activity is detected and remaining time ≤ `adaptiveExtendWindowMs`, bounded by `adaptiveMaxTotalSec`. Fields `effectiveTimeoutMs`, `adaptiveExtensions`, and `adaptiveExtended` reflect extensions. `terminationReason` unifies completion states (no need to infer from exit code 124). Real execution durations use high‑resolution timing and are coerced to ≥1ms; blocked or unconfirmed attempts record as 0ms but are excluded from latency averages/percentiles.

### CLI Flags

| Flag | Effect | Env Equivalent |
|------|--------|----------------|
| `--disable-self-destruct` | Disables injected PowerShell self-destruct timer | `MCP_DISABLE_SELF_DESTRUCT=1` |
| `--enable-self-destruct` | Re-enables timer if previously disabled | (unset `MCP_DISABLE_SELF_DESTRUCT`) |
| `--quiet` | Suppresses verbose startup banners | `MCP_QUIET=1` |
| `--minimal-stdio` | Launch experimental minimal JSON-RPC framer (diagnostic) | Forces `MCP_FRAMER_DEBUG=1` |
| `--framer-debug` | Enable verbose framing logs in normal mode | `MCP_FRAMER_DEBUG=1` |
| `--framer-stdio` | Enterprise server over custom framer (bypasses SDK transport) | Optional `MCP_FRAMER_DEBUG=1` |

Minimal stdio mode:

Use when diagnosing client initialize hangs or suspected framing bugs. Provides:

1. Raw RX/TX framing logs (header/body lengths, hex preview of first bytes)
2. Reduced surface (only initialize, tools/list, run-powershell)
3. Forced confirmation bypass (always runs with confirmed=true) for quicker iteration

Not production hardened: no size caps, auth, or metrics integration. Exit this mode before performance or security testing.

Framer stdio mode:

- Full enterprise tool surface, custom framing (diagnostics / isolation of SDK transport issues)
- Uses same security & tool dispatcher, omits SDK StdioServerTransport
- Prefer this over minimal for reproducing initialize issues with complete feature set

Alpha Cleanup Notes:

- Legacy MCP_INIT_DEBUG initialize sniffer removed; rely on --minimal-stdio / --framer-stdio plus --framer-debug for byte-level framing logs.
- Duplicate framing instrumentation consolidated under MCP_FRAMER_DEBUG.
- Future: unify tool schema list to eliminate maintenance duplication between framer and SDK paths.

## Monitoring

`./Simple-LogMonitor.ps1 -Follow` for rolling logs (when structured logging enabled). Metrics dashboard hosted by embedded HTTP server (URL logged on startup).

### Metrics Dashboard (Expanded)

Top counters now include (when feature flag `limits.capturePsProcessMetrics` or env `MCP_CAPTURE_PS_METRICS=1` is active and at least one PowerShell invocation has completed):

- PS CPU AVG(s): Mean cumulative CPU seconds consumed per invocation (from in-process PowerShell host).
- PS CPU P95(s): 95th percentile CPU seconds across invocations since last reset.
- PS WS AVG(MB): Mean Working Set (resident) size in megabytes captured at invocation end.
- PS WS P95(MB): 95th percentile Working Set MB.
- PS Samples: Number of invocations contributing to the aggregates.

These cards remain hidden until at least one sample arrives to avoid clutter when the feature is disabled.

JSON snapshot (`/api/metrics`) fields:

```jsonc
{
  "psSamples": 17,
  "psCpuSecAvg": 0.42,
  "psCpuSecP95": 0.88,
  "psWSMBAvg": 92.1,
  "psWSMBP95": 110.5
}
```

Attempt / execution split (appears when any attempts recorded):

```jsonc
{
  "attemptCommands": 5,                 // total blocked + confirmation-required attempts
  "attemptConfirmationRequired": 4,      // attempts needing confirmation (RISKY/UNKNOWN)
  "executionCommands": 12,               // real executions with duration > 0
  "confirmedExecutions": 8,              // executions of RISKY/UNKNOWN with confirmed:true
  "confirmationConversion": 0.667        // confirmedExecutions / attemptConfirmationRequired
}
```

Reset behavior: invoking any future explicit reset endpoint (planned) or process restart clears aggregates. Presently they persist for lifetime of server.

Latency semantics:

- Zero-duration rows (blocked / confirmation-required) are NOT added to latency aggregates.
- Real executions: high-res `duration_ms` (rounded) ≥1ms stored.
- Percentile (p95) uses ceil-based index over sorted non-zero durations (avoids downward bias with small N).

Per-invocation row columns already list raw `PS CPU(s)` and `WS(MB)` for each run-powershell execution when metrics are enabled.

## Unknown Command Learning

UNKNOWN â†’ normalize â†’ queue â†’ review â†’ approve â†’ SAFE cache (`learned-safe.json`). Approved patterns immediately influence classification.

## Tests (Jest)

Run: `npm run test:jest`

Coverage highlights: parity (tool surface), run-powershell behaviors (timeout, truncation), server-stats shape, working directory policy, syntax check, help topics, learning queue, classification expansions (git/gh, OS, alias), self-destruct timeout.

### PowerShell Process Metrics Aggregation (Feature Flag)

Enable via env `MCP_CAPTURE_PS_METRICS=1` (or config `limits.capturePsProcessMetrics: true`). Aggregated fields: `psSamples`, `psCpuSecAvg`, `psCpuSecP95`, `psWSMBAvg`, `psWSMBP95`.

Test `ps-metrics-aggregation.test.js/ts` ensures these appear (dynamic metrics port detection). If failing, confirm the metrics server port (logs show `HTTP server listening on http://127.0.0.1:<port>`).

Run it (ensure a fresh build so `dist/` contains latest instrumentation):

```powershell
npm run build
$env:MCP_CAPTURE_PS_METRICS = '1'
$env:METRICS_DEBUG = '1'
npm run test:jest -- -t "aggregates ps metrics"
```

If it fails locally but succeeds in CI (or vice versa), suspect a stale `dist/` directory or an alternate server entrypoint excluding the instrumentation. Rebuild and re-run.

## Roadmap (Excerpt)

- Phase 2 (done): dynamic overrides, metrics, rate limiting.
- Phase 3: cancellation, pluggable policies, signing, dynamic learned pattern integration.
- Phase 4: log rotation, redaction, self-test tool, per-category metrics (VCS_*, OS_*), dashboard timeout charts.

## Periodic Operational Checks

Daily baseline, weekly metrics trend review, post-hardening test bursts, monthly metrics archive pruning.

## Git Hooks

Enable pre-commit:
 
```powershell
git config core.hooksPath .githooks
```

Disable:
 
```powershell
git config --unset core.hooksPath
```

## Contributing

```powershell
npm run compliance:check
npm run build
```

## License

Proprietary (internal hardening branch).

### Timeout & Adaptive Hardening (Aug 2025)

Core fields: configuredTimeoutMs, effectiveTimeoutMs, originalTimeoutSeconds, warnings[], terminationReason, timedOut, internalSelfDestruct, watchdogTriggered, killEscalated, killTreeAttempted, adaptiveExtensions, adaptiveExtended, adaptiveMaxTotalMs.

Parameter guidance:

| Canonical | Deprecated / Alias | Notes |
|-----------|--------------------|-------|
| aiAgentTimeoutSec | aiAgentTimeout | Emits deprecation warning |
| aiAgentTimeoutSec | timeout / timeoutSeconds | `timeout` deprecated; `timeoutSeconds` accepted with advisory |

Adaptive enable flags: `progressAdaptive:true` (preferred) or legacy `adaptiveTimeout:true`.

Adaptive knobs (optional):

| Field | Default | Purpose |
|-------|---------|---------|
| adaptiveExtendWindowMs | 2000 | If remaining time ≤ window & recent activity, consider extend |
| adaptiveExtendStepMs | 5000 | Extension amount per step |
| adaptiveMaxTotalSec | min(base*3,180) | Hard cap horizon |

Environment variables (quick reference):

| Env | Effect |
|-----|--------|
| MCP_DISABLE_SELF_DESTRUCT=1 | Disable internal early exit timer |
| MCP_CAPTURE_PS_METRICS=1 | Enable per-invocation CPU / WS sampling |
| MCP_OVERFLOW_STRATEGY=return\|truncate\|terminate | Select overflow handling mode |
| METRICS_DEBUG=true | Verbose metrics instrumentation logging |
| MCP_DISABLE_ATTEMPT_PUBLISH=1 | Suppress early attempt publishing (blocked / confirmation-required) |
| MCP_OVERFLOW_STRATEGY=truncate | (Example) produce truncated strategy behavior |

Long timeouts (≥60s) emit a responsiveness warning; durations <1ms are promoted to 1ms to avoid misleading 0ms displays.

