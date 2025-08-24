# 📚 Knowledge Index

> Key Learning: The `activate_<category>_tools` functions are the reliable method for MCP tool enablement in VS Code environments, especially for automated/agent workflows.

> 🚨🚨🚨 ULTRA-CRITICAL ENFORCEMENT BANNER (DO NOT BYPASS) 🚨🚨🚨
>
> ABSOLUTE RULE: **DO NOT ISSUE RAW TERMINAL COMMANDS WHEN AN MCP TOOL CAN ACHIEVE THE OUTCOME. ALWAYS ROUTE THROUGH A REGISTERED MCP SERVER TOOL INSTEAD OF DIRECT TERMINAL.**
>
> WHY THIS IS NON-NEGOTIABLE:
>
> - Maintains security classification (SAFE/RISKY/DANGEROUS/CRITICAL/BLOCKED/UNKNOWN) & confirmation gating.
> - Preserves audit invariants (stderr, pretty log, NDJSON) and metrics/rate-limit lineage.
> - Ensures timeout escalation metadata (timedOut, configuredTimeoutMs, killEscalated) is captured.
> - Guarantees threat & alias tracking signals reach dashboard + history endpoint.
> - Enables reproducibility & deterministic enforcement (no invisible side-paths).
>
> MCP GATING CHECKLIST (ALL must be NO to even CONSIDER terminal) — evaluate across ALL registered MCP servers (aggregate tool surface):
>
> 1. Exists specialized MCP tool (on any registered server: e.g., Git server tools, log-test, server-stats, ai-agent-test, GitHub/Issue tools, etc.)?
> 2. Can generic `powershell-command` run the shell/PowerShell you were about to run? (Usually YES.)
> 3. Would using terminal cause loss of audit/metrics/security classification? (If YES → BLOCK.)
> 4. Is this routine repo hygiene (git ops) now covered by git-* tools? (If YES → use tools.)
> 5. Has a similar prior terminal attempt been replaced by a tool this session? (If YES → use tool.)
>
> If ANY answer = YES → Terminal usage is FORBIDDEN.
>
> MANDATORY TERMINAL EXCEPTION BLOCK (only if all above = NO):

```text
Terminal Exception:
Reason: <concise justification>
Gate Evaluation: toolExists=<true/false>; genericPossible=<true/false>; losesAudit=<true/false>; gitToolExists=<true/false>; priorReplaced=<true/false>
Risk Mitigation: <steps to minimize risk>
```

> Without this exact formatted block the attempt is INVALID and must be auto-replaced with an MCP tool plan.
>
> FINAL FALLBACK PRINCIPLE: When uncertain, ALWAYS default to MCP tool invocation. Ambiguity is treated as a BLOCK → choose MCP.

> Copilot / AI Agent Note: Procedural assistant behavior (how to choose tools, escalation sequence, prohibited behaviors) is defined in `COPILOT-INSTRUCTIONS.md`. This knowledge index only summarizes the universal rule above to avoid circular duplication.

> Consolidated, living reference of architectural principles, security patterns, documentation conventions, and operational learnings for the PowerShell MCP Server.
>
> Sources: `docs/ARCHITECTURE.md`, `SESSION-LEARNINGS.md`, commit history (notably diagram + dark theme refinements up to 537c25b).

---

## 1. Core Architecture Principles

- **Deterministic Pipeline**: Authenticate → Rate Limit → Classify → (Confirm?) → Execute → Log → Stream Metrics.
- **Explicit Trust Boundaries**: No execution until classification & (if needed) confirmation succeed.
- **Fail Closed**: Block on ambiguity (UNKNOWN requires confirmation; blocked patterns never execute).
- **Observability First**: Every decision pathway emits audit + metrics signals.
- **Composable Extensibility**: New tools register centrally; dynamic regex overrides allow runtime adaptation without code edits.

## 2. Security Enforcement & Classification

| Aspect | Guideline | Rationale |
|--------|-----------|-----------|
| Pattern Tiers | SAFE / RISKY / DANGEROUS / CRITICAL / BLOCKED / UNKNOWN | Clear enforcement semantics. |
| Confirmation | Required only for RISKY + UNKNOWN | Minimizes friction while preserving guard rails. |
| Blocking | DANGEROUS, CRITICAL, BLOCKED short‑circuit execution | Prevents side‑effects from high‑risk commands. |
| Dynamic Overrides | Merge additionalSafe / additionalBlocked after suppressing unwanted built‑ins | Runtime flexibility. |
| Threat Tracking | UNKNOWN frequency + alias correlation | Detect emerging malicious patterns. |

### Classification Heuristics

- Regex-driven evaluation + alias/suspicious pre-check short‑circuits to CRITICAL when warranted.
- Cache merged patterns (safe/risky/blocked) to avoid recomputation.
- Provide granular reasons in `SecurityAssessment` for audit transparency.

## 3. Documentation & Diagramming (Mermaid + Dark Theme)

Recent Lessons (Commits culminating in 537c25b):

1. **GitHub Mermaid Strictness**: Use JSON `init` blocks (`%%{init: {"theme":"dark", ...}}%%`). Single‑quoted or non‑JSON structures can intermittently fail.
2. **Avoid Escaped Newlines**: Replace literal `\n` inside labels with either real newlines (flowchart) or simplify wording. `<br/>` works but can cause layout quirks—prefer concise labels.
3. **Simplify Node Labels**: Complex punctuation + brackets increase parsing failures; flatten text.
4. **High-Contrast Class Diagrams**: Explicitly set `classTextColor`, `classTitleColor`, `classBackground`, `classBorderColor` to mitigate low contrast on dark theme.
5. **DRY Opportunity**: Repeated theme blocks could be refactored by documenting a canonical snippet (manual reuse; Mermaid has no native include).
6. **Validation Gap**: No automated pre-commit Mermaid render check; propose adding a script to parse code blocks and attempt a `mmdc` (Mermaid CLI) render for early failure detection.

### Proposed Mermaid Validation Script (Future)

- Extract ```mermaid fences.
- Write each to temp file; run `mmdc` (or lightweight parser) in CI.
- Fail build on render error; surface diagram name/line number.

## 4. Tooling & Prompt Reproducibility

| Tool | Learning | Actionable Practice |
|------|----------|--------------------|
| `agent-prompts` | Deterministic retrieval of phase prompts | Keep headings stable; treat as public contract. |
| Prompt Library | Phased orchestration boosts recovery speed | Update architecture docs when phases change. |
| Help Surface | Embedding tool listing reduces onboarding churn | Regenerate on tool additions. |

## 5. Monitoring & Observability

- **Metrics Registry**: Central ingestion for execution, classification, rate-limit, threat events.
- **SSE Stream**: Real-time dashboard updates; test with artificial load to ensure backpressure resilience.
- **Audit Layers**: stderr (human), `.log` (pretty JSON), `.ndjson` (machine). Keep NDJSON stable for SIEM ingestion.
- **Performance Signals**: Include event loop lag + memory; consider percentile tracking (P95) as next enhancement.

## 6. Dynamic Pattern Overrides & Extensibility

| Mechanism | Behavior | Considerations |
|-----------|----------|----------------|
| `additionalSafe` | Adds permissive patterns | Validate they cannot mask risky substrings inadvertently. |
| `additionalBlocked` | Hard blocks new patterns | Keep concise; over-broad regex can cause false positives. |
| `suppressPatterns` | Removes built-in patterns before merge | Audit suppressions in logs for traceability. |
| Merge Cache | Lazy init + reuse | Invalidate when config file timestamp changes (future). |

## 7. Threat & Alias Tracking Insights

- Alias correlation accelerates escalation for repeated obfuscated attempts.
- Frequency tracking supports anomaly detection (e.g., spike in UNKNOWN within session).
- Potential Enhancement: Sliding time window metrics (UNKNOWN per minute) + threshold alerts.

## 8. Session-Specific Learnings (Cross-Repository Log Monitor)

See `SESSION-LEARNINGS.md` for detailed transformation from path-based to process-based discovery:

- Runtime process interrogation > static path config.
- Brace-count JSON reconstruction for pretty multi-line logs.
- Multi-fallback directory extraction prevents hangs.
- Enterprise readiness: isolation, auditability, scalability.

## 9. Known Gaps / TODO

| Area | Gap | Proposed Next Step |
|------|-----|--------------------|
| Mermaid CI | No automated render test | Add validation script + GitHub Action. |
| Pattern Overrides | No live reload | Watch config file; invalidate cache. |
| Threat Metrics | Lacks temporal granularity | Add rolling window counters. |
| Prompt Tests | Minimal automated coverage | Add tests for category filter + json format. |
| Theme Reuse | Repetition across diagrams | Document canonical JSON snippet; optional doc generation script. |

## 10. Contribution Guidelines (Knowledge Areas)

1. Update this index when adding: new security levels, tool surfaces, diagram categories, or monitoring signals.
2. Reference commit hash + short description in append-only CHANGELOG section (below) for traceability.
3. Keep sections scoped: prefer linking to deep docs vs duplicating large tables.

### CHANGELOG (Reverse Chronological)

| Commit | Date (UTC) | Area | Summary |
|--------|-----------|------|---------|
| 537c25b | 2025-08-22 | Docs/Theming | Improved dark theme contrast for class diagrams. |
| 621888a | 2025-08-22 | Docs/Diagrams | Final Mermaid fixes (metrics & pattern overrides). |
| 7022c2b | 2025-08-22 | Docs/Diagrams | Fixed classification, rate limiter, WD enforcement diagrams. |
| (earlier) | 2025-08-22 | Docs/Theming | Added dark theme JSON init across diagrams. |

---

## 9.1 Operational Incident Log (Assistant Behavior)

| Date (UTC) | Incident | Root Cause | Remediation | Permanent Safeguards |
|-----------|----------|------------|-------------|----------------------|
| 2025-08-23 | Attempted raw terminal execution of simple test command despite available MCP `powershell-command` tool | Skipped MCP gating checklist; did not activate/inspect tool surface first; incorrect assumption of tool unavailability | Enforce immediate MCP tool surface activation check; emit direct `powershell-command` payload instead of terminal; only proceed to terminal with fully populated Terminal Exception block | Added "Tool Surface Activation First" step to safeguard list; classify any bypass attempt as policy violation; require logging of gate evaluation when denial occurs |
| 2025-08-23 | Assistant produced unsolicited scripts & repeated clarifications instead of executing MCP tool payload requests (user intent: direct tool invocation) | Failure to adhere to ULTRA-CRITICAL MCP-first minimal-response rule; over-elaboration when execution bridge unavailable | Defined payload-only mode; removed creation of helper scripts unless explicitly requested | Pre-check gate before responding: (a) Is user asking for action? → supply single tools/call payload only; (b) No multi-option responses unless user says "options"; (c) No new artifacts without explicit verbs: add / create / implement |

Guideline Reinforcement:

1. "Learn &lt;server&gt;" = Request tools/list output first; no source inspection until requested.
2. Action verbs (run, execute, list, test, commit) = Single MCP payload only.
3. If execution channel missing: state once, still provide payloads; do not escalate with scripts.
4. Any remediation steps must be appended here to preserve institutional memory.
5. Always activate/verify MCP tool surface before any command; never propose terminal path without explicit gate evaluation + Terminal Exception block (all NO) logged.



---

## 11. Usage

Treat this file as the **entry point** for architectural and operational understanding. Drill into:

- `docs/ARCHITECTURE.md` for visual flows & structural diagrams.
- `SESSION-LEARNINGS.md` for deep-dive case study on log monitor evolution.

---

Maintainers: Update proactively; do not wait for quarterly retros.
