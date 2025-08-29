# Troubleshooting Guide (Metrics, Adaptive Timeout, Framer)

Last updated: 2025-08-29

This guide provides deterministic steps to diagnose common runtime observability issues without speculative patch stacking.

---

## 0. Common Tool Call Errors

### 0.1 Confirmation Required Error

**Symptom**: `MCP error -32600: Confirmation required: Unclassified command requires confirmation`

**Cause**: Commands classified as `RISKY` or `UNKNOWN` require explicit confirmation, but wrong parameter name was used.

**Root Cause Analysis**:

- **UNKNOWN commands** (never seen before): Always require `confirmed: true` on first call
- **RISKY commands** (pre-classified as potentially disruptive): Always require `confirmed: true`  
- **SAFE commands** (pre-classified or learned): Execute immediately, no confirmation needed

**Solution**: Use `"confirmed": true`, NOT `"confirm": true`

```json
❌ Wrong:
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run-powershell","arguments":{"command":"git commit","confirm":true}}}

✅ Correct:
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run-powershell","arguments":{"command":"git commit","confirmed":true}}}
```

**Why This Happens**: The server code checks `args.confirmed`, but many users intuitively try `confirm`, `confirmation`, or other variants.

**Learning System Note**: Once an UNKNOWN command is approved via the learning system, it becomes SAFE and will execute without `confirmed` on subsequent calls.

### 0.2 Working Directory Issues

**Symptom**: `Working directory not found` or `Working directory outside allowed roots`

**Common Cases**:

- Global MCP server doesn't know VS Code workspace context
- Relative paths resolved against server startup directory, not workspace
- Security policy `enforceWorkingDirectory` enabled but path not in `allowedWriteRoots`

**Solution**: Always specify absolute paths when using global MCP server:

```json
{
  "command": "Get-ChildItem *.ps1", 
  "workingDirectory": "C:\\Your\\Actual\\Workspace\\Path"
}
```

---

## 1. PowerShell Process Metrics (`psSamples`)

### 1.1 Expected Flow

1. Child PowerShell appends sentinel line: `__MCP_PSMETRICS__<cpuSeconds>,<workingSetMB>` to stdout (and stderr mirror if enabled).
2. Executor strips sentinel from user output, parses numbers, assigns `psCpuSec`/`psWSMB`.
3. `metricsRegistry.record()` receives those fields and appends to internal arrays.
4. `/api/metrics` returns `psSamples` >= number of successful invocations with metrics.

### 1.2 Minimal Verification

Manual run (Windows PowerShell / pwsh):

```powershell
set MCP_CAPTURE_PS_METRICS=1
node dist/server.js --quiet
```

Then send a JSON-RPC call (simplest):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"diag"},"capabilities":{}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run-powershell","arguments":{"command":"Get-Date","confirmed":true}}}
```

Check /api/metrics (curl or browser) for `psSamples: 1`.

### 1.3 If `psSamples` Stays 0

| Step | Check | Expected | Action if Failing |
|------|-------|----------|-------------------|
| Step | Check | Expected | Action if Failing |
|------|-------|----------|-------------------|
| A | Sentinel presence | Raw stream contains __MCP_PSMETRICS__ | If absent run: Get-Process -Id $PID; fallback to GetCurrentProcess() values. |
| B | Parser debug log | `[METRICS][CAPTURE]` line shows numeric cpu/ws values | If undefined, verify regex & locale; sentinel emitted with invariant culture so investigate chunk split fallback. |
| C | Registry record | Trace shows incrementing `psSamples` | If not incrementing, confirm `metricsRegistry.record` call not short-circuited by early return. |
| D | Snapshot | `/api/metrics` includes new ps fields | If arrays populated internally but snapshot empty, ensure snapshot sets ps fields when `psCpu.length > 0`. |

\n### 1.4 Locale Edge Case
Some locales emit commas for decimals (e.g. `1,25`). Current regex only matches `.`. Mitigation: format CPU seconds explicitly in invariant culture or remove non-digit separators then reinsert decimal.

\n### 1.5 Cleaning Up
After confirmed working:
\n1. Remove any temporary one-off instrumentation (only `METRICS_DEBUG` is permanent).
2. Squash or revert speculative parsing branches not required.
3. Update README aggregated metrics excerpt if field names changed.

---

## 2. Adaptive Timeout Diagnosis

| Symptom | Likely Cause | Resolution |
|---------|--------------|-----------|
| Premature timeout despite output | Extend window too small | Increase `adaptiveExtendWindowMs` relative to emission interval. |
| Runtime grows unbounded | Missing `adaptiveMaxTotalSec` | Set explicit cap (default 3× base or <=180s). |
| No extensions logged | Output inactivity / classification blocked | Inspect `adaptiveLog` events; ensure progress produced inside window. |

\n### 2.1 Capturing Adaptive Log
Enable with `progressAdaptive=true` on tool call; examine `structuredContent.adaptiveLog` for `extend`, `grace`, `timeout` sequence.

---

## 3. Framer Mode Issues

| Issue | Check | Fix |
|-------|-------|-----|
| Initialize hang | Missing Content-Length header | Ensure exact `Content-Length: <bytes>\r\n\r\n` framing before JSON. |
| Tools list empty | `toolList` not populated before framer loop | Confirm server constructor executed `setupHandlers()` before entering loop. |
| Duplicate responses | Both SDK transport and framer active | Avoid calling `server.start()` when `--framer-stdio` is used. |

---

## 4. Iteration Checklist Template

Copy for each investigative loop:

```text
Hypothesis:
Change:
Expected Evidence (tag/value):
Run Command / Test:
Outcome:
Next Action (Proceed/Revert & why):
```

Store temporarily; delete once resolved to avoid stale documentation drift.

---

## 5. Removal of Temporary Flags

Before release / merge to `master`:
\n1. Confirm no references to removed temporary flags.
2. Remove dead fallback parsing branches.
3. Run full test suite with flags off to catch hidden dependencies.

End of Troubleshooting Guide.


---

## 6. FAQ

| Question | Answer |
|----------|--------|
| Why not sample multiple times per process? | End-of-process snapshot avoids timer overhead & race conditions for short commands. |
| Why strip sentinel? | Prevent leaking internal metrics markers into agent-visible stdout, keeping tool output deterministic. |
| Why average + p95 only? | Minimally useful central + tail metrics; p50/p99 can be added once variance justifies cost. |

---
End of Troubleshooting Guide.
