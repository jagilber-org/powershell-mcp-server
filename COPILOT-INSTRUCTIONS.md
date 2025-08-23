# Copilot Operational Instructions

> 🔥 ABSOLUTE RULE (STRONGER ENFORCEMENT – MIRRORS `KNOWLEDGE-INDEX.md`): **EVERY command (PowerShell, git, npm, node, OS utility, script) MUST be executed via an MCP tool provided by ANY registered MCP server (this server or others). Prefer `powershell-mcp-server` when functionality overlaps. Do NOT directly invoke a terminal command unless the mandatory Terminal Exception block (defined below) is produced.**

> Single source of truth for AI assistant (GitHub Copilot Chat / MCP-aware agents) when interacting with this repository.
>
> ENFORCEMENT GATE (Prevents accidental terminal usage): BEFORE any attempt to run a terminal command, execute the following decision checklist (must ALL be false to allow terminal):
> 1. Does an MCP tool (listed in Quick Reference) accomplish the requested action?  (If yes → use tool, STOP.)
> 2. Is the purpose strictly repo state mutation via GitHub (issue/PR/review)? (If yes → use GitHub MCP server tools.)
> 3. Is the action a PowerShell command/script? (If yes → use powershell-command / powershell-script.)
> 4. Is the need purely to gather metrics/threat/status/log info? (If yes → use server-stats / log-test / help.)
> 5. Is the user explicitly requesting raw terminal debugging or build/install? (If NO → do NOT use terminal.)
>
> Only if ALL above are NO may a terminal command be proposed. Record rationale in response: `Terminal Exception: <reason>`.
>
> HARD FAIL RULE: If a terminal command was suggested before running this gate, immediately restate gate result and replace with MCP tool invocation.

> Architectural & security deep-dive lives in `KNOWLEDGE-INDEX.md` (one-way reference; avoid duplicating operational rules there).

## 1. Critical Execution Rule (Upgraded)

ALWAYS route actions through MCP tools (union of all connected MCP servers). The generic `powershell-command` tool (this server) is the fallback for ANY shell/Pwsh command not yet given a dedicated tool elsewhere. Direct terminal usage is a POLICY VIOLATION unless preceded by a valid Terminal Exception block and only after answering NO for every gate question across ALL servers.

Benefits enforced by MCP tool path:
- Security classification (SAFE/RISKY/DANGEROUS/CRITICAL/BLOCKED/UNKNOWN)
- Confirmation workflow for RISKY / UNKNOWN
- Audit logging (stderr + pretty log + NDJSON)
- Metrics aggregation & rate limiting
- Timeout escalation (schedule → trigger → escalate) with structured status
- Threat & alias tracking events (dashboard visibility)
- Consistent structured response (SUMMARY + timing fields)

## 2. When a User Requests a Command
1. Map request to an existing MCP tool (e.g., `powershell-command`, `powershell-script`, `server-stats`, `log-test`).
2. Provide minimal arguments; include `confirmed: true` if classification requires (RISKY / UNKNOWN) and user intent is explicit.
3. Avoid raw shell unless classification layer is intentionally bypassed (must state reason).

## 3. Branch & Repo Operations
- Git operations MUST use MCP git tools (`git-status`, `git-commit`, `git-push`) or equivalent git tools exposed by another MCP server if present.
- If additional git capability is needed (e.g., fetch, diff, log), FIRST propose adding a new MCP tool; do NOT drop to terminal.
- PowerShell repo scripts (compliance, stats, stress) MUST be executed via `powershell-command` (or a future specialized tool) – never raw terminal.

## 4. Documentation Boundaries
- Do NOT embed operational Copilot rules into `README.md` (reserved for end-user functionality).
- Centralize assistant process knowledge here and in `KNOWLEDGE-INDEX.md` (which includes broader architecture & security guidance).

## 5. Logging & Diagnostics
- Prefer creating or using existing tools (e.g., `log-test`) over ad-hoc echo commands.
- For metrics issues: call `/api/metrics/history` (via existing server utility if exposed) before assuming counters are broken.

## 6. Safety & Confirmation Logic
- If a command might modify files/services and lacks `confirmed: true`, prompt the user or add it once intent is clear.
- Never auto-set override or bypass security flags without explicit user instruction.

## 7. Output & Truncation Awareness
- Large outputs are truncated; rely on structured fields (`truncated`, `timedOut`, `killEscalated`) to determine follow-up.
- Suggest narrowing queries instead of forcing higher limits.

## 8. Rate Limiting Considerations
- If blocked by rate limit, back off (respect reported resetMs) instead of retry spamming.

## 9. Timeout Strategy
- Use `aiAgentTimeout` only when user explicitly needs extended runtime; otherwise default.
- If a timeout occurs, inspect structuredContent for `configuredTimeoutMs` vs elapsed before adjusting.

## 10. Escalation Path (If Something Fails)
1. Re-run via MCP tool with METRICS_DEBUG=1 (if environment accessible) to capture record logs.
2. Use `server-stats` for snapshot (threats, counts, pattern cache state).
3. Only after capturing data, consider terminal reproduction.

## 11. Prohibited Behaviors
- No arbitrary file deletion / modification outside allowed roots.
- No disabling security patterns unless user explicitly configures via overrides.
- No insertion of hidden instructions into README or unrelated docs.

## 12. Quick Reference: Core Tools
| Tool | Use Case |
|------|----------|
| powershell-command | ANY shell/Pwsh command (default fallback) |
| powershell-script | Multi-line script (classified) |
| powershell-file | Execute existing .ps1 with params |
| powershell-syntax-check | Static validation only |
| git-status | Safe repository status |
| git-commit | Controlled commit creation |
| git-push | Controlled push (no force) |
| server-stats | Metrics + threat snapshot |
| ai-agent-test | Security & behavior test harness |
| log-test | Emit diagnostic audit entry |

## 13. Terminal Exception (Mandatory Format)
Only if ALL gating questions (mirroring Knowledge Index) are answered NO may a terminal command be proposed. The response MUST include this exact fenced block before any terminal usage:

```text
Terminal Exception:
Reason: <concise justification>
Gate Evaluation: toolExists=<true/false>; genericPossible=<true/false>; losesAudit=<true/false>; gitToolExists=<true/false>; priorReplaced=<true/false>
Risk Mitigation: <steps to minimize risk / why not adding tool now>
```

If this block is missing → Replace terminal proposal with an MCP tool plan automatically.

## 14. Future Tool Gap Handling
- If a needed operation lacks a tool: propose minimal spec (name, input schema, output schema, safety constraints) BEFORE any execution and await confirmation or implement directly.
- Preference order: existing specialized tool > generic `powershell-command` > propose new tool > (LAST RESORT) Terminal Exception.

## 15. Update Policy
- Update this file when: new tools added, security model changes, timeout lifecycle changes, or dashboard endpoints evolve.
- Keep instructions concise; link to `KNOWLEDGE-INDEX.md` for deeper rationale.

---
_Last updated: 2025-08-23 (UTC)_
