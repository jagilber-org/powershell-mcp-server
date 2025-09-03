# Security Classification Layers

This document explains the layered PowerShell command classification pipeline used by the enterprise PowerShell MCP server. It complements existing security docs (see `HARDENING-DESIGN.md`, `KNOWLEDGE-INDEX.md`).

## Layer Order (First Match / Escalation Model)

1. Static BLOCK / CRITICAL patterns (hard deny)
2. Static SAFE patterns (fast allow)
3. Learned-safe normalized candidates (post-approval queue)
4. Verb Baseline Heuristic (approved PowerShell verbs => SAFE baseline)
   - Example safe/neutral verbs: Get, Test, Measure, Format, Select, Where, Sort.
5. Noun & Switch Escalation  
   - Destructive nouns (Service, Process, Item, ItemProperty, Variable, Alias, Module, Job) combined with mutation verbs (Set, Stop, Remove, New, Clear, Disable, Restart) escalate to at least RISKY.  
   - Presence of `-Force` or `-Recurse` on a mutation command adds escalation (cannot lower severity).
6. Legacy / generic heuristic fallbacks (UNKNOWN if nothing matched and not obviously safe)
7. Learning System (records UNKNOWN for later administrator review) – occurs after classification to avoid hiding threats.

The first decisive classification (BLOCKED, SAFE, RISKY, etc.) is returned; later layers cannot downgrade a decision (only escalate or record metadata).

## Confirmation Requirement

Any command classified as RISKY or UNKNOWN requires `confirmed:true` in the tool arguments. Attempt events without confirmation are recorded as ATTEMPT_* metrics but not executed.

## Overrides

An optional JSON file `config/verb-overrides.json` may supply arrays:

```json
{
   "safeVerbs": ["Resolve","Find"],
   "riskyVerbs": ["Restart"],
   "dangerousVerbs": ["Format"],
   "blockedVerbs": ["Disable"]
}
```

These are merged (case-insensitive) after built‑in defaults. Overrides cannot remove a built‑in blocked verb; they can only escalate or add new ones.

## Escalation Rules (Current)

- Mutation verbs + destructive nouns => at least RISKY.
- `-Force` or `-Recurse` on mutation verbs escalate UNKNOWN -> RISKY and SAFE -> RISKY (never de-escalate).

## Future Enhancements (Planned)

- Weighting model for combined risk factors (switch count, pipeline chain length).
- Noun category ingestion from official PowerShell vocab for finer granularity.
- Explainability field: structured reasons array returned in structuredContent.

## Structured Output Fields

`securityAssessment` includes:

- `level`: final classification level.
- `blocked`: boolean.
- `requiresPrompt`: whether confirmation required.
- `patterns`: triggering pattern names (if any).
- `verb`, `noun`: parsed components when available.

## Rationale

Layered approach gives transparent, deterministic, and override-able classification while remaining conservative (favor escalation over premature allow) and supporting an incremental learning loop.

