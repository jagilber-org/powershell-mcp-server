# Changelog

## v1.3.2 - 2025-09-01

Stability & Observability:

- Correct PowerShell CPU metric sampling (delta seconds via cumulative cpuUsage) exposing psCpuSecLast & accurate psCpuPct line.
- Dashboard always shows PS legend when samples > 0 and falls back to horizontal line if per-sample missing.
- Added debug logging hooks (literal tags: `[DASH][PS_CPU]` / `[DASH][PS_WS]`) for diagnostics.
- Adaptive timeout telemetry improvements (effective vs configured alignment; adaptive log retained).
- Minor deployment health check manifest logic (future: manifest healthCheck property refactor).

Next (not yet implemented): externalized dash bundle, version stamp header, CSP tightening.

## v1.3.0 - 2025-09-01

Focus: Security hardening, protocol simplification, deterministic schemas, adaptive execution metrics.

Highlights:

- Removed legacy line-based JSON protocol (framed Content-Length only now).
- Minimized tool surface (no git* tools exposed; central tool registry introduced).
- Added deterministic manual JSON schema for `run-powershell` (stable property ordering for tests / clients).
- Enhanced security classification (git mutation vs read-only, registry/service/network/disk risk patterns, Invoke-Expression block, force-push detection).
- Adaptive timeout system: progressive extension on activity (`progressAdaptive` / `adaptive*` params) with structured telemetry (effectiveTimeoutMs, extensions count).
- Unified timeout parameter (`aiAgentTimeoutSec`); legacy aliases produce warnings (deprecation + long timeout guidance).
- Metrics subsystem revamp (registry + HTTP server) with bootstrap events and aggregation tests; added partial-output timeout & overflow handling strategies (return/truncate/terminate) with structured fields.
- Added minimal framed server for fast initialize/tools list tests.
- Removed legacy VSCode adapter entry files (`vscode-server.ts`, `vscode-server-enterprise.ts`) – unified `server.ts` is now the only entry point.
- Improved working directory policy enforcement and security audit logging.
- Version bump to 1.3.0; production deploy script unchanged (now deploys framed-only build).

Breaking Changes:

- Legacy newline-delimited protocol removed; only Content-Length framed MCP supported.
- Deprecated timeout parameter names (`aiAgentTimeout`, `timeout`) – still accepted but emit warnings; prefer `aiAgentTimeoutSec`.
- Tool listing no longer includes any git operations; clients relying on them must invoke PowerShell commands directly (subject to classification & confirmed gating).

Upgrade Notes:

1. Update clients to ensure framed protocol handling (remove any legacy fallback logic).
2. Adjust tooling to consume new structured timeout/adaptive fields (`effectiveTimeoutMs`, `adaptiveExtensions`, `overflowStrategy`).
3. Monitor metrics via the HTTP server for early regression detection.
4. Review deprecation warnings and migrate to canonical parameter names.

Security / Hardening:

- Force push, destructive git patterns & Invoke-Expression flagged/blocked.
- Output overflow strategies enforced with configurable truncation & termination logic.
- Deterministic schema reduces surface for schema-drift based exploits/tests flakiness.

Internal / Testing:

- Added high-coverage Jest suites for classification, adaptive timeouts, overflow modes, metrics bootstrap, and working directory policies.
- Coverage >90% statements; remaining uncovered lines are low-risk test utilities.

## v1.2.x

- Prior stable series before removal of legacy protocol & adaptive metrics overhaul.
