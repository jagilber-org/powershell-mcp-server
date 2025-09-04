# Product Requirements Document (PRD)

Title: PowerShell MCP Server - Timeout Hardening, Adaptive Execution, and Deterministic Termination
Version: 1.0 (Aug 2025)
Status: In Implementation (Pending Full Suite Validation & Merge)
Owner: Engineering (Enterprise Tooling)

## 1. Purpose
Provide reliable, explainable, and enforceable execution lifecycle guarantees for PowerShell tool invocations used by AI agents. Eliminate ambiguity around why a process ended, prevent false classification of hangs, and enable controlled runtime extension for genuinely progressing tasks without inflating static timeouts.

## 2. Goals
| Goal | Description | Success Metric |
|------|-------------|----------------|
| Deterministic Outcome | Every execution communicates canonical end state | 100% responses include terminationReason |
| Hang Accuracy | No false positives for hangs | 0 failing hang tests across 30 consecutive runs |
| Adaptive Efficiency | Reduce need for large static timeouts while allowing progress | 1 adaptive extension in >70% of synthetic progressive tasks |
| Backward Compatibility | No breaking change to existing clients/scripts | All legacy tests pass |
| Observability | Easier analytics on termination patterns | Future metrics can group by terminationReason with no retrofits |

## 3. Non-Goals
- Implement per-user quota enforcement (separate roadmap)
- Provide cancellation RPC (future enhancement)
- Cryptographic response signing
- Full anomaly detection on termination distributions

## 4. Scope
In-Scope:
- `run_powershell` execution model changes
- Timeout classification rewrite + terminationReason
- Adaptive extension loop & fields (effectiveTimeoutMs, adaptiveExtensions)
- Test coverage additions (hang, adaptive, fast-exit)
- Documentation updates (README, ARCHITECTURE, HARDENING, CRITICAL TIMEOUT COMMANDS)
- Health test fallback resilience

Out-of-Scope (Phase Deferred):
- Cancellation semantics
- Metrics counters per terminationReason
- terminationReasonDetail subcodes
- External policy plugin injection

## 5. Stakeholders
| Role | Interest |
|------|----------|
| AI Agent Runtime | Needs deterministic error states |
| Security Review | Requires auditable classification & kill paths |
| SRE / Ops | Needs clear reason for timeouts vs kills |
| Developer Productivity | Reduced need to over-provision timeouts |

## 6. User Stories
1. As an agent, I need to know if a command timed out vs exited with error so I can retry safely.
2. As an operations engineer, I want deterministic hang detection to avoid zombie processes.
3. As a platform integrator, I want adaptive extension so I can set conservative initial timeouts.
4. As a security auditor, I need a single termination field for log correlation.

## 7. Requirements
### Functional
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F1 | Add terminationReason enum | P0 | DONE |
| F2 | Set terminationReason mutually exclusively | P0 | DONE |
| F3 | Implement adaptive timeout loop | P0 | DONE |
| F4 | Expose effectiveTimeoutMs, adaptiveExtensions | P1 | DONE |
| F5 | Preserve backward overflowStrategy | P1 | DONE |
| F6 | Provide forced hang test (loop) | P0 | DONE |
| F7 | Enforce hang duration  80% configured timeout | P1 | DONE |
| F8 | Add fast exit control test | P1 | DONE |
| F9 | Update docs (README, Architecture, Hardening) | P0 | DONE |
| F10 | Health tool fallback parsing | P1 | DONE |
| F11 | Adaptive test ensures extension > base | P1 | DONE |
| F12 | Expose warnings for deprecated timeout params | P2 | DONE |
| F13 | Enforce minimum reported duration 1ms for real executions | P2 | DONE |
| F14 | Exclude zero-duration attempts from latency aggregation | P2 | DONE |

### Non-Functional

| ID | Requirement | Metric |
|----|-------------|--------|
| N1 | Performance overhead for SAFE command  +5% | Benchmark (deferred) |
| N2 | Deterministic test stability | No intermittent failures across 20 CI runs |
| N3 | Log clarity | terminationReason present in 100% audit entries |
| N4 | Config safety | Adaptive never exceeds maxTotalSec |

## 8. Assumptions

- Unified timeout parameter: timeout_seconds only (legacy fields removed).
- Adaptive extension only matters for interactive or streaming output tasks.
- Termination reasons are sufficient without detail codes initially.

## 9. Constraints

- Must not block existing CI pipelines.
- Cannot introduce external service dependencies.
- Must operate within Windows PowerShell and PowerShell Core environments.

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Adaptive loop runaway | Starvation of watchdog | Hard cap + watchdog fallback |
| Misclassification due to race | Incorrect audit logs | Single finish gate sets reason |
| Hang test flakiness | CI noise | Deterministic command + duration threshold |
| Backward client assuming absence of terminationReason | None (additive) | N/A |

## 11. Architecture Delta Summary

- Added terminationReason derivation in `finish()`.
- Added adaptive loop with periodic remaining-time checks & extension scheduling.
- Watchdog marks `killed` if unresolved.
- Self-destruct timer tuned to maximum adaptive horizon.

## 12. Data Model Changes

| Field | Type | Notes |
|-------|------|-------|
| terminationReason | string enum | Always present |
| adaptiveExtensions | number | 0 if disabled |
| adaptiveExtended | boolean | Derived from extensions > 0 |
| effectiveTimeoutMs | number | Mirrors configured if no extensions |

## 13. Telemetry / Observability

Current: terminationReason included in audit + metrics publish payload (row-level). Non-zero real execution durations aggregated for average & p95; zero-duration attempts (blocked / unconfirmed) excluded. Future: aggregate distribution, alert if spike in `killed`.

Environment Variable Controls (documented for operability):

| Variable | Purpose |
|----------|---------|
| MCP_CAPTURE_PS_METRICS=1 | Enable per-invocation CPU/WS sampling (with fallback baseline) |
| MCP_DISABLE_SELF_DESTRUCT=1 | Disable internal 124 timer (debugging) |
| MCP_OVERFLOW_STRATEGY=truncate\|return\|terminate | Override overflow handling mode |
| METRICS_DEBUG=true | Verbose metrics diagnostic logs |

## 14. Testing Strategy

- Unit / integration hybrid via Jest harness spawning server.
- Negative control (fast-exit) to guard hang false positive.
- Adaptive positive path ensures at least one extension (extension window tuned in test).
- Health resilience test covers structured vs legacy output schema.

## 15. Rollout Plan

1. Land branch `integrate/timeouts-watchdog` with all tests green.
2. Monitor audit & metrics manually on staging instance.
3. Add optional warning in release notes encouraging agents to migrate timeout param.

## 16. Rollback Strategy

- Revert commits adding terminationReason & adaptive loop.
- Disable adaptive by not passing adaptiveTimeout flags.
- Keep hang test for regression detection even after rollback.

## 17. Open Follow-Ups

| Item | Owner | Target |
|------|-------|--------|
| terminationReason metrics aggregation | Eng | Next minor update |
| cancellation RPC design | Eng | Draft Q4 |
| terminationReasonDetail extension | Eng | Post metrics |

## 18. Acceptance Checklist

- [x] All functional requirements F1-F12 met
- [x] F13 / F14 implemented (min duration + exclusion of zero-duration attempts)
- [x] All new tests stable locally
- [ ] Full suite pass on branch (pending)
- [ ] PR description updated with new scope
- [ ] Merge approval

## 19. Appendix: Hang Command Justification

The chosen loop uses `Console.ReadKey($true)` ensuring a blocking wait that doesn't flood CPU and cannot complete naturally. Sleep fallback protects environments without a console. This ensures the timeout mechanism--not normal completion--ends the process.

## 20. Syntax Check Enhancements (Sept 2025)

Added optional analyzer & caching not in original scope.

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| S1 | Cache parse results (100) | P2 | DONE |
| S2 | Expose `cacheHit` field | P2 | DONE |
| S3 | Optional analyzer pass w/ availability flag | P2 | DONE |
| S4 | Structural imbalance post-parse scan | P2 | DONE |
| S5 | Env flags documented (`PWSH_SYNTAX_FORCE_FALLBACK`, `PWSH_SYNTAX_ANALYZER`) | P2 | DONE |

---
End of PRD
