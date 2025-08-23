# PowerShell MCP Server Hardening & Enterprise Readiness Plan

## 1. Current State Summary

The project implements an enterprise-oriented PowerShell MCP server with:

- 5-level security classification (SAFE/RISKY/DANGEROUS/CRITICAL/BLOCKED + UNKNOWN)
- Pattern-based risk assessment (registry, system dirs, remote ops, dangerous commands)
- Alias detection, unknown threat tracking
- Audit logging with structured JSON-like entries (stderr + file)
- Working directory support for command/script/file execution
- AI agent help system & internal test harness
- Compliance checker (MCP spec heuristic validation)
- Universal log monitor script with multi-workspace discovery

Gaps / observations:

- No dedicated README for onboarding
- Security patterns static; no runtime configuration or allowlist/denylist override
- Authentication optional; dev mode warning present but no rotation/logging of key usage
- No rate limiting or concurrency control (possible resource abuse risk)
- Timeout handling exists; no progressive backoff or cancellation token bridging
- Tool responses not cryptographically signed (integrity not guaranteed if intercepted locally)
- Limited validation on workingDirectory path (no explicit canonicalization / path traversal guard beyond spawn cwd)
- No explicit memory / output size safeguards (large stdout could bloat logs)
- Lack of structured JSON log writer (mix of console formatting + AUDIT lines)
- Tests: integration tests cover workingDirectory; need broader coverage (security classification, auth on/off, timeout behavior)
- No metrics / health endpoint (just console stats)
- No plugin / extension boundary for adding patterns without code change

## 2. Design Principles

1. Security must not block legitimate admin & read operations (Get-*, discovery commands)
2. Least privilege path usage (isolate writes to explicit working dirs / temp)
3. Configurability: patterns, thresholds, auth, logging verbosity
4. Observability: structured logs + metrics + testable invariants
5. Fail-safe: classification errors default to UNKNOWN needing confirmation, not silent allow
6. Performance: minimal overhead for SAFE commands

## 3. Threat Model (Concise)

| Vector | Risk | Current Mitigation | Gap | Action |
|--------|------|--------------------|-----|--------|
| Destructive FS ops (Remove-Item) | High | Pattern classification (RISKY) | No granular scope control | Add path policy layer |
| System directory tampering | Critical | Pattern block (System32 etc.) | Reliant on regex; lacks canonical path check | Normalize & verify real path |
| Remote code execution (Invoke-Command) | High | Pattern block | Partial pattern coverage | Expand + dynamic config |
| Data exfiltration via web cmdlets | High | Patterns (DownloadString etc.) | Missing for Invoke-RestMethod upload patterns | Extend pattern set |
| Resource exhaustion (loops / large output) | Medium | Timeout only | No output cap / line limit | Add max stdout/lines limit |
| Auth bypass (dev mode) | Medium | Warning only | No runtime toggle enforcement or audit of key absence | Config requireAuth flag + explicit refusal |
| Privilege escalation via aliases | Medium | Alias detection | No quarantine suggestions | Add remediation guidance |
| Path traversal workingDirectory | Medium | Direct pass-through | No explicit validation | Resolve + ensure inside allowed base |

## 4. Proposed Enhancements (Phased)

### Phase 1 (Foundation)

- Add README with quick start, security modes, test commands
- Implement configuration file (e.g., `mcp-config.json`) expansion: security.enforceAuth, security.allowedWriteRoots, limits.maxOutputKB, limits.maxLines
- Add path normalization & allowed root enforcement before spawn
- Add stdout/stderr size guard (truncate with notice & audit flag)
- Add structured JSON audit writer (machine-readable) alongside human console output
- Extend tests: SAFE command, RISKY requiring confirmation, BLOCKED command, output truncation

### Phase 2 (Dynamic Security & Observability)

- Support dynamic pattern overrides via config (additionalSafe, additionalBlocked, suppressedPatterns)
- Introduce rate limiting (simple in-memory token bucket per clientPid)
- Add metrics object (command counts per level, avg duration) with a tool `server-stats`
- Add tool `security-report` returning current patterns & counts of detections
- Add environment variable overrides for CI/easy toggles

### Phase 3 (Advanced Hardening)

- Optional command signing / HMAC verification (agent-signed payload field)
- Add persistent unknown threat cache with aging + summary on startup
- Implement cancellation (expose a cancel tool referencing request id -> kills process)
- Pluggable policy hooks: allow dropping a JS module in `policies/` that exports enrich/assess functions
- Structured log shipping option (emit NDJSON file)

### Phase 4 (Reliability & Governance)

- Add self-test tool that runs classification sanity checks
- Add config schema validation with zod & on-load diagnostics
- Provide redaction layer for sensitive env vars appearing in output
- Add disk space guard for logs (rotate oldest when exceeding size cap)

## 5. Implementation Outline (Phase 1 Detail)

1. Config Enhancements

- Extend existing `mcp-config.json` or create if absent:

  ```jsonc
  {
    "security": {
     "enforceAuth": true,
     "allowedWriteRoots": ["${TEMP}", "./sandbox"],
     "requireConfirmationForUnknown": true
    },
    "limits": {
     "maxOutputKB": 256,
     "maxLines": 2000,
     "defaultTimeoutMs": 90000
    },
    "logging": {
     "structuredAudit": true,
     "truncateIndicator": "<TRUNCATED>"
    }
  }
  ```

1. Path Enforcement Utility

- Resolve workingDirectory with `fs.realpathSync`
- Reject if outside allowed roots (config-driven) with securityAssessment=BLOCKED

1. Output Limiter

- Stream listeners accumulate bytes/lines; if exceed, stop reading further, mark truncated

1. Structured Audit

- Introduce `writeAudit(entry: AuditLogEntry)` that writes JSON lines to file `./logs/audit-YYYY-MM-DD.ndjson`
- Ensure safe fallback if write fails (console.warn)

1. Tests

- Add `tests/test-security-classification.mjs`
- Add `tests/test-output-truncation.mjs`
- PowerShell script test: blocked path attempt

## 6. Data Structures

```ts
interface Config {
  security: { enforceAuth: boolean; allowedWriteRoots: string[]; requireConfirmationForUnknown: boolean };
  limits: { maxOutputKB: number; maxLines: number; defaultTimeoutMs: number };
  logging: { structuredAudit: boolean; truncateIndicator: string };
}
interface TruncationMeta { truncated: boolean; originalBytes: number; keptBytes: number; }
```

## 7. Edge Cases & Handling

- Missing config file: load defaults, emit warning
- Invalid path in allowedWriteRoots: skip & warn
- workingDirectory symlink: realpath before comparison
- Output exactly on boundary: do not mark truncated
- Truncation occurs: add `truncated: true` field in audit entry
- Command blocked: exitCode null + reason in response

## 8. Success Criteria (Phase 1)

- All existing tests pass + new tests added
- Legitimate SAFE commands unaffected (<5% overhead) (qualitative for now)
- RISKY without confirmation -> blocked with clear message
- BLOCKED patterns fully prevented
- Output > limits truncated with audit flag
- Unauthorized workingDirectory outside allowed roots blocked

## 9. Rollback Strategy

- Feature flags in config allow disabling new enforcement if regression found
- Keep legacy behavior if `security.allowedWriteRoots` absent

## 10. Future Considerations

- External policy service integration
- Multi-tenant auth token mapping / scopes
- Telemetry export (OpenTelemetry traces)

---
Generated plan ready for iterative implementation on branch `feature/hardening`.
