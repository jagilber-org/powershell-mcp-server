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

## Security Model

Five security levels classify every command:
SAFE → RISKY → DANGEROUS → CRITICAL → BLOCKED

Unknown commands require confirmation. Blocked or dangerous patterns never run. Aliases and obfuscation patterns are detected and logged.

## Phase 1 Hardening Features

- Config-driven limits (`enterprise-config.json`)
- Working directory root enforcement
- Output size + line truncation with indicator
- Optional structured NDJSON audit logging

## Configuration (`enterprise-config.json`)

```jsonc
{
  "security": {
    "enforceAuth": true,
    "allowedWriteRoots": ["${TEMP}", "./sandbox"],
    "requireConfirmationForUnknown": true
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

Phase 1 new tests (added):

- `test-output-truncation.mjs`
- `test-workingdirectory-policy.mjs`

## Roadmap (Excerpt)

- Phase 2: dynamic pattern overrides, rate limiting, metrics tool
- Phase 3: cancellation, pluggable policies, signing
- Phase 4: log rotation, redaction, self-test tool

## Contributing

Commit frequently on feature branches. Run compliance and build before pushing:

```powershell
npm run compliance:check
npm run build
```

## License
Proprietary (internal hardening branch).
