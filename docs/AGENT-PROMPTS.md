# Project Reproduction Prompt Library

Purpose: Deterministic, auditable reconstruction of the PowerShell MCP Server from empty folder to current feature set (security classification, audit logging, metrics dashboard, alias/threat tracking, rate limiting, prompt tooling). Each phase is atomic, additive, verifiable.

## How To Use

1. Execute phases sequentially.  
2. Apply only described edits (minimal diff).  
3. Build & run minimal tests.  
4. Emit MACHINE_VERIFICATION_BLOCK (see template).  
5. Halt for approval before next phase.  

Safeguards:

- Do not remove existing controls unless a phase declares a Migration.  
- Limit live PowerShell to safe read-only commands (Get-*, Select-*, Measure-*).  
- For RISKY / UNKNOWN actions require explicit confirmed:true.  
- No speculative refactors; defer to Hardening phase.  

## Phase Index

0. Initialization / Scaffold  
1. Core MCP Skeleton  
2. Command Execution Engine  
3. Security Classification  
4. Audit Logging  
5. Core Tool Suite  
6. Threat & Alias Tracking  
7. Rate Limiting + Working Directory Policy  
8. Metrics + HTTP + SSE  
9. Dashboard UI & Visualization  
10. Test & Validation Scripts  
11. Hardening & Dynamic Pattern Overrides  
12. Prompt Retrieval Tool (agent-prompts)  
13. Rebuild Manifest & Integrity Verification  

---
 
## Phase 0 – Initialization / Scaffold

```text
Create package.json (type: module) with scripts: build=tsc, start=node dist/index.js. Add tsconfig (ES2022, strict true, sourceMap true). Add .gitignore (node_modules, dist, logs, *.log). Add src/index.ts placeholder printing banner. Add README summarizing roadmap (Phase Index). Output MACHINE_VERIFICATION_BLOCK with file list + hashes.
```

## Phase 1 – Core MCP Skeleton

```text
Implement src/server.ts exporting async start(): create MCP Server (name/version), connect via stdio, print startup summary, handle SIGINT/SIGTERM for graceful exit. index.ts imports start(). No tools yet. Verification: build succeeds; process stays alive until SIGINT.
```

## Phase 2 – Command Execution Engine

```text
Add executePowerShellCommand(command, timeoutMs, workingDirectory?). Use powershell.exe -NoProfile -NonInteractive. Capture stdout/stderr, exitCode, duration. Enforce limits (config object): maxOutputKB, maxLines with truncateIndicator. Return { success, stdout, stderr, exitCode, duration_ms, error? }. Add minimal test script invoking Get-Date. Verification: run sample command; confirmed truncation logic works with large output.
```

## Phase 3 – Security Classification

```text
Add classifyCommandSafety(command) returning SecurityAssessment { level: SAFE|RISKY|DANGEROUS|CRITICAL|BLOCKED|UNKNOWN, risk, reason, blocked, requiresPrompt?, category, color }. Pattern groups: safe, risky, registry, system file, root destructive, remote, critical, dangerous. UNKNOWN is default requiring confirmed. No enforcement yet (just classification). Add tests for representative commands. Verification: table of sample commands & levels.
```

## Phase 4 – Audit Logging

```text
Implement auditLog(level, category, message, metadata?). Outputs to stderr + file logs/powershell-mcp-audit-YYYY-MM-DD.log and NDJSON structured variant. Sanitize metadata (truncate strings >100 chars). Log system info at startup (CPU, memory, pid). Verification: show sample NDJSON lines count + one parsed object.
```

## Phase 5 – Core Tool Suite

```text
Register tools: powershell-command, powershell-script, powershell-file, powershell-syntax-check, help. Use zod schemas → JSON. On command/script/file: classify then enforce (block if blocked; require confirmed for requiresPrompt). Include securityAssessment in structured output + audit log entry. help tool returns markdown topics (overview, security, monitoring, authentication, examples, capabilities, ai-agents, working-directory). Verification: ListTools output includes all; sample help length > 500 chars.
```

## Phase 6 – Threat & Alias Tracking

```text
Add alias map & suspicious patterns. Track unknown commands: map key=normalized command { frequency, firstSeen, lastSeen, riskAssessment }. Update classifyCommandSafety to record UNKNOWN. Add threat-analysis tool returning stats + optional recent threats. Verification: run unknown command twice; frequency increments; threat-analysis reflects.
```

## Phase 7 – Rate Limiting + Working Directory Policy

```text
Add enterprise-config.json merge (defaults). Implement token bucket (intervalMs, maxRequests, burst) keyed by client PID. Add enforce-working-directory & get-working-directory-policy tools; enforce allowedWriteRoots when enabled. On rate exceed produce McpError + metrics event placeholder. Verification: exceed limit; display remaining tokens & resetMs.
```

## Phase 8 – Metrics + HTTP + SSE

```text
Add metricsRegistry (counts per security level, durations). Add performance sampler: CPU%, RSS, Heap, event loop lag p95 every N ms. Start lightweight HTTP server exposing /api/metrics (JSON) and /events (SSE) which streams execution + perf events. Verification: curl /api/metrics sample JSON; show one SSE event line.
```

## Phase 9 – Dashboard UI & Visualization

```text
Serve single-page dashboard: counters, events table (autoscroll), confirmed highlighting, CPU graph (CPU + lag overlay), memory graph (RSS + Heap). Maintain cpuHistory & memHistory arrays (timestamp,value,...). Provide CSS class for confirmed commands. Verification: textual description of rendered sections + confirmed presence of graphs canvases.
```

## Phase 10 – Test & Validation Scripts

```text
Add tests/ scripts: Quick-MCPTest (basic tool calls), test-rate-limit, test-mcp-protocol, stress-test, working-directory tests. Each outputs concise JSON summary. Add npm test script running the fast subset. Verification: show aggregated pass/fail counts & runtime.
```

## Phase 11 – Hardening & Dynamic Pattern Overrides

```text
Support dynamic pattern arrays in config: additionalSafe, additionalBlocked, suppressPatterns (removes built-ins). Merge lazily. Track metrics for confirmed-required events & truncations. Extend server-stats tool to include dynamicPatterns + rateLimit snapshot. Verification: inject a blocked pattern via config; confirmed classification changes.
```

## Phase 12 – Prompt Retrieval Tool

```text
Add agent-prompts tool: reads docs/AGENT-PROMPTS.md, extracts headings (## <Title>), optional category filter (case-insensitive substring), format=markdown|json. Output { format, categories[], category?, content }. Add 'prompts' topic to help tool listing purpose & example invocation. Verification: agent-prompts returns categories list containing "Phase 0".
```

## Phase 13 – Rebuild Manifest & Integrity Verification

```text
Generate reproduction-manifest.json capturing: schemaVersion, generatedAt, phasesComplete[], fileHashes (SHA256) for src/**, docs/**, tests/**, scripts/** excluding logs, node_modules, dist. Include toolList, patternCounts (safe/risky/blocked), buildInfo (node version, platform). Provide verify script: recompute and diff. Verification: manifest JSON snippet (first 10 file hashes).
```

---
 
## Companion Operational Prompts

### Rebuild Orchestrator

```text
Given Phase Index & optional stopPhase, iterate phases: emit PHASE_PLAN { adds, modifies, risks }; apply; run build/tests; emit MACHINE_VERIFICATION_BLOCK; halt on failure.
```

### Integrity Diff

```text
Compare current workspace with reproduction-manifest.json. Output diff JSON: { added[], removed[], changed[], unchangedCount, riskLevel }. riskLevel: changed>10 HIGH, 1-10 MEDIUM, 0 LOW.
```

### Pattern Extractor

```text
Locate pattern arrays in code; output JSON listing each pattern with group (safe|risky|blockedSubset) and source (core|dynamic). No guessing or synthesis.
```

### Metrics Timeline Summarizer

```text
Given chronological /api/metrics snapshots: compute maxCPU, maxLag, memGrowthPercent, avgExecDuration, blockedRatioTrend. Output Markdown + JSON summary.
```

### Incident Replay

```text
Input: NDJSON slice + threat-analysis. Reconstruct timeline emphasizing BLOCKED/CRITICAL attempts, repeated UNKNOWN confirmations, truncated outputs. Provide prioritized remediation list (impact vs effort score).
```

### Minimal Pre-Execution Self-Check

```text
Given prospective command: return JSON { safetyLevel, needsConfirmation, requiresWorkingDirectory, potentialDataExposure }. If needsConfirmation and none provided: advise adding confirmed:true.
```

---
 
## MACHINE_VERIFICATION_BLOCK Template

```json
{
	"phase": <number>,
	"status": "SUCCESS|FAIL|PARTIAL",
	"created": ["..."],
	"modified": ["..."],
	"removed": ["..."],
	"hashSummary": { "path/file": "sha256" },
	"tests": { "run": 0, "passed": 0, "failed": 0 },
	"metricsPreview": { "cpuMax": 0, "blocked": 0 },
	"risks": ["..."],
	"nextPhaseHint": "..."
}
```

## Retrieval Example

```json
{ "tool": "agent-prompts", "params": { "category": "Phase 8", "format": "markdown" } }
```

---
This file supersedes older prompt drafts. Keep it stable; amend only via a documented Hardening migration.
