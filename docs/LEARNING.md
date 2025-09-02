# Unknown Command Learning (Phases A - C Queue Workflow)

This document details the secure, human-in-the-loop pipeline for evolving UNKNOWN PowerShell commands into explicitly approved safe patterns **without ever storing raw unredacted command text**.

## Goals

- Capture emergent, frequently used UNKNOWN commands.
- Redact potentially sensitive tokens immediately (paths, GUIDs, IPs, hashes, emails).
- Normalize & hash (HMAC) structure for aggregation while preventing raw leakage.
- Provide transparent scoring to assist human reviewers (recommendations, NOT auto-promotion).
- Promote only approved normalized forms as anchored regex patterns (exact intent, flexible whitespace).

## Phase A: Capture & Aggregation

1. Detection: Any command classified UNKNOWN triggers journaling via `recordUnknownCandidate`.
2. Redaction: Deterministic regex replacement -> placeholders (e.g., `OBF_PATH`).
3. Normalization: Lowercase + single-space collapse ensures equivalent structural forms merge.
4. HMAC Structural Hash: Non-reversible digest ensures uniqueness without exposing source.
5. Journal File: `learnCandidates.jsonl` (rotated by size; append-only NDJSON lines).
6. Aggregation: `aggregateCandidates()` groups by normalized form, tracking:
   - count
   - first / last timestamp
   - distinct session IDs
   - sample redacted variant (for UI display only)

### Tool: `list-unknown-candidates`

Returns aggregated candidates (redacted + normalized) for manual review.

## Phase B: Recommendations (Scoring)

Adds intelligent scoring to prioritize review - but does **not** itself approve anything.

### Scoring Model (`recommendCandidates`)

Weights (sum=1):

- Frequency (count): 0.40
- Distinct sessions: 0.25
- Density (count / span seconds): 0.20
- Recency (1/(1+hoursSinceLast)): 0.15

Score = weighted normalized components -> scaled 0-100 (two decimals). Rationale string embeds raw factor values for audit.

### Tool: `recommend-unknown-candidates`

Input: `limit`, `minCount`.
Output: array of `{ normalized, score, rationale, count, distinctSessions, lastTs }`.

## Phase C: Queue & Approval (Human-in-the-Loop Governance)

Instead of immediate promotion, normalized candidates are **queued** for explicit review. This provides an auditably separated decision point before expanding the SAFE surface.

### Queue Storage

File: `learn-queue.json` (array of entries) with fields:

- `normalized`
- `added` (first queued timestamp)
- `lastQueued`
- `timesQueued` (re-queue attempts)
- `source` (e.g., `dashboard`, `tool`)

### Tools

- `queue-learn-candidates` -> `{ added, skipped, total }`
- `list-learn-queue` -> `{ queued: [...] }`
- `approve-learn-queue` -> Promotes provided normalized forms then removes them from queue. Returns `{ promoted, added, skipped, total, patterns }`.
- `remove-from-learn-queue` -> Deletes specified queued normalized forms without promotion `{ removed, remaining }`.

### Approval / Promotion Path
When approving, each normalized string is transformed into an anchored case-insensitive regex with flexible internal whitespace: `^<escaped_norm_with_\s+>$`. Entries are appended to `learned-safe.json` including metadata `{ normalized, added, pattern, source }` and the in-memory merged SAFE pattern set is reloaded so new approvals take effect immediately.

### Direct Promotion (Legacy / Migration)
`promote-learned-candidates` still exists for batch operations outside the normal queue (e.g., migrating pre-reviewed patterns). Standard governance SHOULD prefer queue + approve.

## Security Considerations

- Raw command text never written to disk by learning pipeline.
- Redaction patterns intentionally conservative; expansion should prefer additive placeholders.
- HMAC secret (`UNKNOWN_LEARN_SECRET`) can rotate; only affects new entries (old hashes remain opaque).
- Promotion stores only normalized forms; reviewers must ensure no dangerous semantics hidden by placeholders.

## UI Integration

- Dashboard streams UNKNOWN events including `candidateNorm` enabling row selection.
- Action button: "Queue Selected" adds the normalized form to the review queue.
- Queue Panel: lists queued entries with batch Approve / Remove actions (checkbox multi-select).
- Selected UNKNOWN row highlight: CSS class `learn-selected` (purple outline) persists until another selection.

## File Inventory

| File | Purpose |
|------|---------|
| `src/learning.ts` | Redaction, normalization, journaling, aggregation, scoring, promotion persistence |
| `learnCandidates.jsonl` | Append-only journal (redacted) |
| `learned-safe.json` | Approved normalized entries + regex patterns (active SAFE expansion) |
| `learn-queue.json` | Pending review queue prior to approval |
| `src/server.ts` | Emits `candidateNorm` in UNKNOWN events; exposes MCP tools |
| `docs/LEARNING.md` | This detailed design |

## Future Enhancements

- Research / analysis stage (static risk heuristics) before approval button enabled.
- Pattern generalization (parameter placeholders) with differential risk scoring.
- Expiration / decay for stale low-frequency queued or learned patterns.
- Enhanced UI: rationale tooltips, diff vs existing SAFE patterns, score sorting in queue.
- Telemetry: score distribution snapshots + queue aging metrics.

## Minimal JSON-RPC Examples

List candidates:

```json
{"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"list-unknown-candidates","arguments":{"limit":10}}}
```

Recommend:

```json
{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"recommend-unknown-candidates","arguments":{"limit":5,"minCount":1}}}
```

Queue then Approve:

```json
{"jsonrpc":"2.0","id":43,"method":"tools/call","params":{"name":"queue-learn-candidates","arguments":{"normalized":["get-process obf_path"]}}}
```

```json
{"jsonrpc":"2.0","id":44,"method":"tools/call","params":{"name":"approve-learn-queue","arguments":{"normalized":["get-process obf_path"]}}}
```

## Review Checklist for Approval

- [ ] Redaction placeholders acceptable (no sensitive literal remnants)
- [ ] Command semantics safe (read-only, introspection, harmless path access)
- [ ] Frequency justifies allowlisting (avoid noise)
- [ ] No overlap with blocked/risky patterns
- [ ] Normalization retains intended specificity (not over-generalized)

## Changelog

- 2025-08-23: Introduced Phase B recommendation & promotion tools; documentation extracted from `README.md`.
- 2025-08-23: Added Phase C queue governance (queue / approve / remove) + live pattern reload and dashboard queue panel.
