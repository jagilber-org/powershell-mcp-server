# PowerShell MCP Server Hardening & Enterprise Readiness Plan (Aug 2025 Update)

## 1. Current State Summary (Post Timeout & Adaptive Enhancements)

Now includes:
- Deterministic termination classification (`terminationReason: timeout|overflow|killed|completed`)
- Adaptive timeout extension loop with activity-based window & hard max
- Strict hang semantics test (infinite ReadKey loop) preventing false positives
- Health tool robust fallback parsing (structuredContent or content[0].text)
- Overflow strategy retention (`overflowStrategy: return|truncate|terminate`)
- Compliance + architecture docs aligned with new fields
- Deterministic, shared PowerShell host detection (`detectShell`) with precedence & audit logging

Legacy baseline (retained):
- Multi-level security classification & confirmation workflow
- Path enforcement, output truncation, audit logging (NDJSON + human)
- Unknown threat tracking & learning queue
- Metrics dashboard + SSE streaming

## 2. New Capabilities (Delta Focus)

| Capability | Purpose | Key Fields / Args | Tests |
|------------|---------|-------------------|-------|
| terminationReason | Canonical termination state | terminationReason | timeout/adaptive/fast-exit |
| Adaptive Timeout | Extend runtime on active output | adaptiveTimeout / progressAdaptive, adaptiveExtendWindowMs, adaptiveExtendStepMs, adaptiveMaxTotalSec | adaptive timeout test |
| Hang Guard | Prevent early success misclassification | Forced loop command, duration ≥ 80% threshold | timeout hardening hang test |
| Fast Exit Control | Ensure quick commands not flagged as hang | Simple echo command baseline | fast-exit control test |
| Shell Detection | Single synchronous deterministic resolver | `detectShell()` output: exe, source, tried[] | shellDetection precedence test |

## 3. Problem Statements Addressed

| Previous Issue | Impact | Resolution |
|----------------|--------|-----------|
| Ambiguous termination cause | Complex downstream analytics | Added explicit terminationReason enum |
| False hang detection risk | Unreliable timeout regression tests | Introduced infinite ReadKey loop + duration gate |
| Adaptive extension absent | Either premature kill or unsafe large timeout | Activity-based extension within hard cap |
| Health test flakiness | Intermittent CI failure | Fallback to structuredContent + safe JSON parse |
| Racy / inconsistent PowerShell host selection | Potential mismatch between tool & server logging; sporadic legacy host usage | Centralized deterministic `detectShell` with precedence & audit transparency |

## 4. Deterministic Shell Detection

Implementation: `src/core/shellDetection.ts`

Precedence Order:
1. Config override: `enterprise-config.json` -> `shellOverride` (absolute path)
2. Env override: `PWSH_EXE`
3. Well-known install paths (platform-specific)
4. First `pwsh` on PATH
5. First legacy `powershell` on PATH
6. Fallback (Windows: `powershell.exe`, *nix: `pwsh`)

Returned shape:
```ts
{ exe: string; source: 'configOverride'|'env:PWSH_EXE'|'wellKnown'|'path'|'path-legacy'|'fallback'; tried: string[] }
```

Audit Entry: `POWERSHELL_HOST` includes selected host and ordered `tried` list (aids forensic reproducibility).

Benefits:
- Eliminates async race in prior `detectHost` (which spawned processes optimistically).
- Ensures tool execution path matches startup banner & health reporting.
- Provides override transparency (config vs env precedence) for operators.
- Simplifies future addition (e.g., containerized host path) by single list extension.

Edge Cases & Mitigations:
| Scenario | Behavior | Mitigation |
|----------|----------|------------|
| Config override invalid path | Recorded in `tried`, falls through gracefully | Operator sees path in audit for correction |
| Env override set but missing | Same as above | Clear visibility in audit logs |
| No pwsh, legacy present | Selects first legacy path | Encourages upgrade by operator, can add warning later |
| PATH empty (test simulation) | Immediate fallback | Test asserts fallback source |

## 5. Termination Classification Rules

| Condition | terminationReason |
|-----------|-------------------|
| `timedOut` true OR exitCode 124 | timeout |
| `overflow` true | overflow |
| Non-zero exit (no timeout/overflow) | killed |
| Exit 0 and no flags | completed |
| Watchdog triggered, none set | killed |

Mutual exclusivity enforced at finish; integrity tests validate.

## 6. Adaptive Timeout Algorithm

1. Initialize base `configuredTimeoutMs`.
2. Periodically compute remaining time.
3. If remaining ≤ `extendWindowMs` AND recent activity within same window → extend by `extendStepMs`.
4. Never exceed `adaptiveMaxTotalSec` (hard ceiling); internal self-destruct timer aligned to maximum potential runtime.
5. Record `adaptiveExtensions` count; set `adaptiveExtended=true` if any extension applied.

Edge Cases:
- No output: no extension path triggers.
- High-frequency output: multiple extensions until cap.
- Near-cap remaining < extendStepMs: extension skipped.

## 7. Hang Detection Strategy

Command: `while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }`

Strengths:
- Blocks on console read (no natural exit)
- Minimal CPU with small sleep in catch path
- Resistant to normal termination signals until enforced kill

Test Assertions:
- `timedOut || exitCode===124`
- `success === false`
- Elapsed ≥ 0.8 * configuredTimeoutMs
- `terminationReason === 'timeout'`

## 8. Test Inventory (Aug 2025)

| Test File | Coverage |
|-----------|----------|
| run-powershell-timeout-hardening.test.js | Cap, deprecation warnings, forced hang semantics |
| run-powershell-adaptive-timeout.test.js | Adaptive extension & terminationReason consistency |
| run-powershell-fast-exit-control.test.js | Baseline fast completion (no hang misclassification) |
| health.test.js | Health payload fallback parsing |
| shellDetection.test.ts | Deterministic precedence + env override + fallback |
| (Existing) truncation / overflow tests | Output capping integrity |

## 9. Observability Enhancements

Added terminationReason to audit & metrics publish event payload enabling future distribution slices. (Metrics counters for each reason deferred to later phase.) Health output now includes `shell` block.

## 10. Backward Compatibility

- All new fields are additive; existing clients parsing stdout/stderr unaffected.
- Blocked command inline response retained for legacy test harness patterns.
- Deprecated timeout params still accepted with warnings.
- Shell detection change only alters banner order/logs; execution semantics consistent (prefers pwsh when available).

## 11. Risks / Mitigations

| Risk | Mitigation |
|------|------------|
| Adaptive loop mis-extending on idle | Requires recent activity window | 
| Race setting terminationReason | Single assignment inside guarded finish | 
| Hang test flakiness | Deterministic command; duration threshold tolerant (80%) | 
| Output change breaks health test | Structured fallback + safeJson parse | 
| Incorrect host after override | Audit includes tried list for diagnosis | 

## 12. Future Roadmap (Post-Update)

Short-term:
- Termination reason distribution metrics
- Optional cancellation token bridging (client abort → kill)
- terminationReasonDetail subcode (internalSelfDestruct vs watchdog vs escalate)
- Warning if legacy powershell.exe selected (encourage pwsh)

Mid-term:
- Policy plugins for custom classification
- Rich anomaly detection (spike in killed vs completed)
- Structured redaction rules for stdout (PII / secrets scan)

Long-term:
- Cryptographic signing of structuredContent
- External policy evaluation service (OPA/Rego or WASM plugin)
- Multi-tenant isolation profiles

## 13. Acceptance Criteria for This Update

| Criterion | Status |
|----------|--------|
| terminationReason emitted for every execution | ✅ |
| Hang test enforces duration & non-success | ✅ |
| Adaptive test shows effectiveTimeout > configured | ✅ |
| Fast-exit test confirms terminationReason=completed | ✅ |
| Docs updated (README, ARCHITECTURE, HARDENING) | ✅ |
| Compliance summary includes new fields | ✅ |
| Deterministic shell detection logged + test | ✅ |

## 14. Rollback Plan

- Revert `runPowerShell.ts` & `shellDetection.ts` commits if regression observed.
- Disable adaptive by omitting `adaptiveTimeout` argument.
- Retain hang & shell tests to detect regression early.

## 15. Open Items

| Item | Priority |
|------|----------|
| Add metrics counters per terminationReason | High |
| Add cancellation RPC & test | High |
| Add terminationReasonDetail | Medium |
| Add watchdog vs self-destruct histogram | Medium |
| Structured secret redaction in stdout | Medium |
| Legacy host warning telemetry | Medium |

## 16. Summary

This hardening increment delivers deterministic termination semantics, reliable hang detection, adaptive execution safety, and a unified PowerShell host selection mechanism. The shell detection consolidation eliminates race conditions and improves audit transparency while remaining backward compatible. It establishes a clear extension surface for future policy, observability, and security features without destabilizing current clients.
