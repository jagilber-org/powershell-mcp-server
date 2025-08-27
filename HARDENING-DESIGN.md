# PowerShell MCP Server Hardening & Enterprise Readiness Plan (Aug 2025 Update)

## 1. Current State Summary (Post Timeout & Adaptive Enhancements)

Now includes:
- Deterministic termination classification (`terminationReason: timeout|overflow|killed|completed`)
- Adaptive timeout extension loop with activity-based window & hard max
- Strict hang semantics test (infinite ReadKey loop) preventing false positives
- Health tool robust fallback parsing (structuredContent or content[0].text)
- Overflow strategy retention (`overflowStrategy: return|truncate|terminate`)
- Compliance + architecture docs aligned with new fields

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

## 3. Problem Statements Addressed

| Previous Issue | Impact | Resolution |
|----------------|--------|-----------|
| Ambiguous termination cause | Complex downstream analytics | Added explicit terminationReason enum |
| False hang detection risk | Unreliable timeout regression tests | Introduced infinite ReadKey loop + duration gate |
| Adaptive extension absent | Either premature kill or unsafe large timeout | Activity-based extension within hard cap |
| Health test flakiness | Intermittent CI failure | Fallback to structuredContent + safe JSON parse |

## 4. Termination Classification Rules

| Condition | terminationReason |
|-----------|-------------------|
| `timedOut` true OR exitCode 124 | timeout |
| `overflow` true | overflow |
| Non-zero exit (no timeout/overflow) | killed |
| Exit 0 and no flags | completed |
| Watchdog triggered, none set | killed |

Mutual exclusivity enforced at finish; integrity tests validate.

## 5. Adaptive Timeout Algorithm

1. Initialize base `configuredTimeoutMs`.
2. Periodically compute remaining time.
3. If remaining ≤ `extendWindowMs` AND recent activity within same window → extend by `extendStepMs`.
4. Never exceed `adaptiveMaxTotalSec` (hard ceiling); internal self-destruct timer aligned to maximum potential runtime.
5. Record `adaptiveExtensions` count; set `adaptiveExtended=true` if any extension applied.

Edge Cases:
- No output: no extension path triggers.
- High-frequency output: multiple extensions until cap.
- Near-cap remaining < extendStepMs: extension skipped.

## 6. Hang Detection Strategy

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

## 7. Test Inventory (Aug 2025)

| Test File | Coverage |
|-----------|----------|
| run-powershell-timeout-hardening.test.js | Cap, deprecation warnings, forced hang semantics |
| run-powershell-adaptive-timeout.test.js | Adaptive extension & terminationReason consistency |
| run-powershell-fast-exit-control.test.js | Baseline fast completion (no hang misclassification) |
| health.test.js | Health payload fallback parsing |
| (Existing) truncation / overflow tests | Output capping integrity |

## 8. Observability Enhancements

Added terminationReason to audit & metrics publish event payload enabling future distribution slices. (Metrics counters for each reason deferred to later phase.)

## 9. Backward Compatibility

- All new fields are additive; existing clients parsing stdout/stderr unaffected.
- Blocked command inline response retained for legacy test harness patterns.
- Deprecated timeout params still accepted with warnings.

## 10. Risks / Mitigations

| Risk | Mitigation |
|------|------------|
| Adaptive loop mis-extending on idle | Requires recent activity window | 
| Race setting terminationReason | Single assignment inside guarded finish | 
| Hang test flakiness | Deterministic command; duration threshold tolerant (80%) | 
| Output change breaks health test | Structured fallback + safeJson parse | 

## 11. Future Roadmap (Post-Update)

Short-term:
- Termination reason distribution metrics
- Optional cancellation token bridging (client abort → kill)
- terminationReasonDetail subcode (internalSelfDestruct vs watchdog vs escalate)

Mid-term:
- Policy plugins for custom classification
- Rich anomaly detection (spike in killed vs completed)
- Structured redaction rules for stdout (PII / secrets scan)

Long-term:
- Cryptographic signing of structuredContent
- External policy evaluation service (OPA/Rego or WASM plugin)
- Multi-tenant isolation profiles

## 12. Acceptance Criteria for This Update

| Criterion | Status |
|----------|--------|
| terminationReason emitted for every execution | ✅ |
| Hang test enforces duration & non-success | ✅ |
| Adaptive test shows effectiveTimeout > configured | ✅ |
| Fast-exit test confirms terminationReason=completed | ✅ |
| Docs updated (README, ARCHITECTURE, HARDENING) | ✅ |
| Compliance summary includes new fields | ✅ |

## 13. Rollback Plan

- Revert `runPowerShell.ts` to prior commit hash (pre-terminationReason) if regression observed.
- Disable adaptive by omitting `adaptiveTimeout` argument.
- Retain hang test to detect regression early.

## 14. Open Items

| Item | Priority |
|------|----------|
| Add metrics counters per terminationReason | High |
| Add cancellation RPC & test | High |
| Add terminationReasonDetail | Medium |
| Add watchdog vs self-destruct histogram | Medium |
| Structured secret redaction in stdout | Medium |

## 15. Summary

This hardening increment delivers deterministic termination semantics, reliable hang detection, and controlled adaptive execution windows without sacrificing clarity or backward compatibility. It lays groundwork for richer analytics and cancellation features while reinforcing test coverage against regression.
