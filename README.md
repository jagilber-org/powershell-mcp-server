# PowerShell MCP Server (Enterprise Hardening Branch)

## Quick Start

Build and start the enterprise server:

```powershell
npm install
npm run build
npm run start:enterprise
```

(Optionally set an auth key)

```powershell
$env:MCP_AUTH_KEY = "your-strong-key"
npm run start:enterprise
```

## Available Tools

- powershell-script
- powershell-file
- powershell-syntax-check
- help
- ai-agent-test
- threat-analysis
- server-stats

## Security Model

Five security levels classify every command:
SAFE → RISKY → DANGEROUS → CRITICAL → BLOCKED

Unknown commands require confirmation. Blocked or dangerous patterns never run. Aliases and obfuscation patterns are detected and logged.

## Hardening Features

### Phase 1 (Complete)

- Config-driven limits (`enterprise-config.json`)
- Working directory root enforcement
- Output size + line truncation with indicator
- Optional structured NDJSON audit logging

### Phase 2 (In Progress)

- Dynamic security pattern overrides (additionalSafe / additionalBlocked / suppressPatterns)
- Metrics collection (counts by security level, blocked/truncated, average duration)
- `server-stats` tool for runtime metrics & threat + pattern state
- (Planned) Rate limiting (token bucket)

## Configuration (`enterprise-config.json`)

```jsonc
{
  "security": {
    // enforceAuth (optional): enable to require MCP_AUTH_KEY, omitted here for local dev
    "allowedWriteRoots": ["${TEMP}", "./sandbox"],
  "requireConfirmationForUnknown": true,
  // Phase 2 dynamic overrides (all optional)
  "additionalSafe": ["^Get-ChildItem"],
  "additionalBlocked": [],
  "suppressPatterns": []
  },
  "limits": {
    "maxOutputKB": 128,
    "maxLines": 1000,
    "defaultTimeoutMs": 90000
  },
  "logging": {
    "structuredAudit": true,
    "truncateIndicator": "<TRUNCATED>"
  }
}
```

## Writing Commands

Example request (JSON-RPC over stdio):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "powershell-command",
    "arguments": { "command": "Get-Date" }
  }
}
```

Add `confirmed: true` for RISKY / UNKNOWN commands.

## Working Directory Policy

Paths must resolve under one of `security.allowedWriteRoots`. Otherwise the execution returns a policy violation before running PowerShell.

## Output Truncation

Stdout / stderr are truncated when either byte or line limits exceed configuration. A `<TRUNCATED>` marker is appended and an audit field `truncated: true` logged.

## Monitoring

```powershell
./Simple-LogMonitor.ps1 -Follow
```
Or view NDJSON structured log files in `./logs/*.ndjson` when enabled.

## Tests

Run existing protocol/security tests manually via Node or PowerShell scripts in `tests/`.

Phase 1 + 2 tests (added):

- `test-output-truncation.mjs`
- `test-workingdirectory-policy.mjs`
- `test-server-stats.mjs` (metrics + dynamic pattern state)

## Roadmap (Excerpt)

- Phase 2: (partial) dynamic overrides + metrics (DONE), add rate limiting
- Phase 3: cancellation, pluggable policies, signing
- Phase 4: log rotation, redaction, self-test tool

## Git Hooks

Enable the provided PowerShell pre-commit hook (runs build + key tests):

```powershell
git config core.hooksPath .githooks
```

Hook file: `.githooks/pre-commit.ps1` (wrapper `.githooks/pre-commit` for cross-platform). Disable by resetting:

```powershell
git config --unset core.hooksPath
```

## Contributing

Commit frequently on feature branches. Run compliance and build before pushing:

```powershell
npm run compliance:check
npm run build
```

## License

Proprietary (internal hardening branch).
