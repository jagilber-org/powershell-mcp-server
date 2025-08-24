# PowerShell MCP Server (Enterprise Hardening Branch)

## Quick Start

```powershell
npm install
npm run build
npm run start:enterprise
```

Optional auth:

```powershell
$env:MCP_AUTH_KEY = "your-strong-key"
npm run start:enterprise
```

## Available Tools

| Tool | Purpose | Key Arguments |
|------|---------|---------------|
| `emit-log` | Structured audit log entry | `message` |
| `learn` | Manage unknown → safe learning queue | action, limit, minCount, normalized[] |
| `working-directory-policy` | Get/set allowed roots enforcement | action, enabled, allowedWriteRoots[] |
| `server-stats` | Metrics snapshot & counts | verbose |
| `memory-stats` | Process memory (MB) | gc |
| `agent-prompts` | Retrieve prompt library | category, format |
| `threat-analysis` | Unknown / threat tracking stats | — |
| `run-powershell` | Execute command / inline script (classified) | command/script, workingDirectory, timeout (s), confirmed |
| `run-powershellscript` | Alias: inline or from file (inlined) | script or scriptFile, workingDirectory, timeout, confirmed |
| `powershell-syntax-check` | Fast heuristic script check | script, filePath |
| `ai-agent-tests` | Internal harness | testSuite, skipDangerous |
| `help` | Structured help topics | topic |

Notes:

1. `RISKY` & `UNKNOWN` require `confirmed: true`.
2. `run-powershellscript` supports `scriptFile:"relative/or/absolute.ps1"` (read & inlined).
3. Blocked patterns (`Invoke-Expression`, forced destructive VCS, recursive quiet deletes) are rejected pre-exec.
4. Working directory enforcement (when enabled) rejects paths outside `allowedWriteRoots`.

## Security Model

Levels: SAFE → RISKY → DANGEROUS (reserved) → CRITICAL → BLOCKED → UNKNOWN

| Level | Requires confirmed? | Executed? | Example | Category Sample |
|-------|---------------------|-----------|---------|-----------------|
| SAFE | No | Yes | `Get-ChildItem` | INFORMATION_GATHERING |
| RISKY | Yes | Yes | `git pull` | VCS_MUTATION |
| CRITICAL | N/A | No | `git reset --hard` | VCS_DESTRUCTIVE |
| BLOCKED | N/A | No | `Invoke-Expression` | SECURITY_THREAT |
| UNKNOWN | Yes | Yes | `foobar-tool --x` | UNKNOWN_COMMAND |

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

## Configuration (excerpt `enterprise-config.json`)

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
  "limits": { "maxOutputKB": 128, "maxLines": 1000, "defaultTimeoutMs": 90000 },
  "logging": { "structuredAudit": true, "truncateIndicator": "<TRUNCATED>" }
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

Overflow flow:
 
1. Collect chunks until caps exceeded.
2. On overflow: send SIGTERM; optional hard kill after 500ms if `hardKillOnOverflow` true.
3. Response flags `overflow: true`, `truncated: true`.

Execution response (core fields):
 
```jsonc
{
  "success": true,
  "exitCode": 0,
  "timedOut": false,
  "overflow": false,
  "duration_ms": 1234,
  "stdout": "preview",
  "stderr": "",
  "chunks": { "stdout": [ { "seq":0, "bytes": 5120, "text": "..." } ], "stderr": [] },
  "securityAssessment": { "level":"SAFE", "category":"INFORMATION_GATHERING", "reason":"Safe pattern: ^Get-", "blocked":false, "requiresPrompt":false }
}
```

`timedOut: true` pairs with exit code 124 (internal self-destruct) or null (watchdog) and increments TIMEOUTS metric.

Mitigation tips for large output: narrow queries, use `Select-Object -First N`, filter early, or paginate across multiple calls.

## Timeouts & Resilience

External timeout enforced (default 90s). Internal self-destruct arms a timer (lead ~300ms) to exit with code 124, minimizing orphan processes. Post-kill verification escalates to process tree kill on Windows if needed. Metrics: duration, p95, TIMEOUTS counter.

## Monitoring

`./Simple-LogMonitor.ps1 -Follow` for rolling logs (when structured logging enabled). Metrics dashboard hosted by embedded HTTP server (URL logged on startup).

## Unknown Command Learning

UNKNOWN → normalize → queue → review → approve → SAFE cache (`learned-safe.json`). Approved patterns immediately influence classification.

## Tests (Jest)

Run: `npm run test:jest`

Coverage highlights: parity (tool surface), run-powershell behaviors (timeout, truncation), server-stats shape, working directory policy, syntax check, help topics, learning queue, classification expansions (git/gh, OS, alias), self-destruct timeout.

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
