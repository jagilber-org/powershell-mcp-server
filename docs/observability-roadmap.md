# Observability Roadmap (Aug 2025)

This document tracks implemented and planned observability features after the unified server + adaptive timeout refactor.

## 1. Implemented (Current Release)

### Metrics & Aggregation

- Execution counters (success, error, blocked, truncated, timeouts)
- Duration distributions (mean, p95)
- PowerShell process metrics (feature flag `MCP_CAPTURE_PS_METRICS=1`): per-invocation CPU seconds & Working Set MB, aggregated `psSamples`, averages, p95
- Prometheus exposition `/metrics` + JSON snapshot `/api/metrics`

### Adaptive Timeout Telemetry

- `adaptiveLog[]` events embedded in each execution result (extend, grace, terminate)
- `effectiveTimeoutMs` surfaced for post-mortem tuning
- Warnings array (deprecated timeout params, long-running threshold notices)

### Event Streaming

- Server-Sent Events endpoint `/events` for live dashboard updates (executions, classification, rate limit blocks)

### Structured Logging

- NDJSON audit stream including classification, rate limit, overflow, timeout outcomes
- Redaction layer (secrets, fenced `secret` blocks)

### Framer Mode Diagnostics

- Minimal and enterprise framer modes emit verbose framing logs when `MCP_FRAMER_DEBUG=1`
- Distinguishes protocol framing issues from tool runtime errors

## 2. Near-Term (In Progress / Next)

- Deterministic metrics port strict mode (`METRICS_STRICT=1`) → fail instead of auto-increment when port busy (stabilizes test harness expectations)
- Metrics snapshot consistency guard (lock during aggregation to prevent partial percentile arrays)
- Lightweight `/api/metrics/reset` endpoint (manual clear for long-running agent sessions)
- p95 adaptive extension count metric (`adaptiveExtendP95`)

## 3. Planned (Design Approved)

- Per-category metrics (SAFE/RISKY/UNKNOWN latency distribution tables)
- Cancellation telemetry (canceled count, mean time-to-cancel)
- Output overflow strat counters (by strategy)
- Rolling window stats (last 1m / 5m / 15m cumulative) alongside lifetime totals
- Event loop lag histogram (using periodic `setImmediate` drift sampling)

## 4. Stretch / Exploration

- OpenTelemetry trace export (span per execution with classification + timeout attributes)
- Pluggable metrics sinks (file rotation, external push gateway)
- Adaptive timeout auto-tuner (feedback loop adjusting extendStep based on historical completion delta)

## 5. Technical Notes

PowerShell process metrics are captured via a sentinel JSON line appended by the invoked script footer. The executor strips and parses this line, ensuring zero impact on user-facing stdout while preserving deterministic parsing. Failure to parse (corruption, partial output) is silently ignored unless `METRICS_DEBUG=1` (then a debug log line is emitted).

Percentile calculation currently uses simple sort (sufficient at low hundreds of samples). Future optimization: replace with fixed-size reservoir or streaming P² estimator when sample count surpasses configurable threshold (e.g. 10k) to cap memory usage.

## 6. Reliability Guardrails

- All optional telemetry paths are feature-flagged or no-op when disabled to minimize baseline overhead.
- Aggregation arrays cleared only on restart (idempotent snapshot reads).
- Retry logic around HTTP server binding currently increments port; strict mode will remove this nondeterminism for test environments.

## 7. Open Questions

- Should percentile stats exclude truncated/timeouts to avoid skew? (Pending empirical analysis.)
- Do we surface separate CPU / WS metrics for timeouts vs normal completions? (Needs cost/benefit evaluation.)

---
Living document; update alongside feature PRs touching metrics, logging, or timeout behavior.
