# PowerShell MCP Server

Enterprise-ready Model Context Protocol (MCP) server exposing secure, policy-aware PowerShell automation and supporting tooling (syntax analysis, metrics, audit, deployment helpers). Designed for AI agent integration, reproducible observability, and progressive hardening.

## ✨ Key Features

- Hierarchical security levels: SAFE -> RISKY -> DANGEROUS (reserved) -> CRITICAL -> BLOCKED -> UNKNOWN (learning path)
- Command safety classification + confirmation gating (`confirmed: true`)
- PowerShell syntax parsing + optional PSScriptAnalyzer integration (cached)
- Adaptive execution timeouts, output chunking & overflow safeguards
- Structured audit logging (text + NDJSON) & pattern learning pipeline
- Unified configuration layering (defaults -> config file -> env -> CLI)
- Deployment script with backups & manifest (`scripts/deploy-prod.ps1`)
- TypeScript codebase with Jest test suite

## 📁 Project Structure

```text
.github/                 GitHub workflows, issue templates, Copilot instructions
bin/                     Built entry points / packaged artifacts
build/                   Build scripts
config/                  Config files (enterprise-config, jest, mcp)
data/                    Data assets (knowledge index, learned patterns)
deploy/                  Deployment helpers
docs/                    Extended documentation & design notes
logs/                    Runtime / audit logs (gitignored)
scripts/                 PowerShell operational & monitoring scripts
src/                     TypeScript source (server, tools, security)
tests/                   Jest tests
tools/                   Auxiliary analysis scripts
```

## 🚀 Quick Start

```bash
npm install
npm run build
npm start            # Starts MCP server
```

Optional auth key:

```bash
set MCP_AUTH_KEY="your-strong-key"   # Windows (PowerShell: $env:MCP_AUTH_KEY="your-strong-key")
npm start
```

CLI examples (after build):

```bash
node dist/cli.js --dump-config
node dist/cli.js --no-metrics --dry-run
```

## ⚙ Configuration Layers

Order of precedence (low -> high):

1. Internal defaults (`src/config.ts`)
2. `config/enterprise-config.json`
3. Environment variables
4. CLI flags (`dist/cli.js`)

Supported (Phase 1) keys:

| Domain   | Key          | Env Var                   | CLI Flag        | Description                                     |
|----------|--------------|---------------------------|-----------------|-------------------------------------------------|
| metrics  | enable       | MCP_METRICS_ENABLE=true   | --no-metrics    | Toggle in-memory metrics collection             |
| security | enforceAuth  | MCP_ENFORCE_AUTH=true     | (future flag)   | Require auth key for tool calls when enabled    |

Auth key (when `enforceAuth` true): set `MCP_AUTH_KEY`.

## 🛠 Core Tools (Representative)

| Tool                   | Purpose                              | Notes                                                       |
|------------------------|--------------------------------------|-------------------------------------------------------------|
| run-powershell         | Execute PowerShell                   | Classified; needs `confirmed:true` if RISKY/UNKNOWN          |
| powershell-syntax-check| Parse & (optional) analyze script    | Native parser + optional analyzer via env                   |
| server-stats           | Metrics / threat snapshot            | Read-only                                                   |
| audit / admin (future) | Administrative introspection         | Gated                                                       |

### Classification Flow

```text
UNKNOWN -> normalize -> queue -> review -> approve -> SAFE cache
  ^                                                      |
  +------------------- pattern learning -----------------+
```

- BLOCKED patterns never execute
- RISKY requires explicit confirmation
- SAFE executes immediately

## ⏱ Execution Controls

- External timeout + internal self-destruct timer (exit code 124)
- Adaptive extension (progress based): fields `effectiveTimeoutMs`, `adaptiveExtensions`
- Output chunking & truncation (total byte & line caps)
- Overflow strategies: terminate vs truncate vs return

## 🔐 Security Levels

| Level     | Confirmation | Executes | Typical Category                  |
|-----------|--------------|----------|-----------------------------------|
| SAFE      | No           | Yes      | Read-only, benign                  |
| RISKY     | Yes          | Yes      | File edits, writes, moderate risk |
| DANGEROUS | (reserved)   | No       | Destructive ops (future policy)   |
| CRITICAL  | Always blocked | No     | High-risk patterns                |
| BLOCKED   | N/A          | No       | Policy denied                     |
| UNKNOWN   | Yes          | Yes      | New / unclassified                |

Every invocation emits audit + metrics with safety level & duration.

## 🧪 Testing

```bash
npm run test:jest       # Build + run Jest
npm run build:only      # TypeScript compile only
```

Selective metrics / pattern tests live under `tests/jest/`.

## 📦 Deployment (Windows Example)

```powershell
pwsh ./scripts/deploy-prod.ps1 -Destination C:\mcp\powershell-mcp-server
```

Common options:

- `-SkipTests` skip jest
- `-IncludeDev` include devDependencies
- `-NoBackup` skip timestamp backup
- `-DryRun` preview only
- `-NoPreserveLearned` do not restore existing `learned-safe.json`

Produces `deploy-manifest.json` with commit, hashes, timestamped backup.

## 🔍 Syntax Checking (Programmatic)

```ts
import { parsePowerShellSyntax } from './src/tools/pwshSyntax.js';
const result = await parsePowerShellSyntax('Write-Output "Hi"');
console.log(result.ok, result.issues);
```

Enable analyzer: `PWSH_SYNTAX_ANALYZER=1`.

## 🧩 CLI Flags

| Flag                 | Description                                |
|----------------------|--------------------------------------------|
| `--no-metrics`       | Disable metrics collection                  |
| `--key <key>`        | Set auth key (overrides MCP_AUTH_KEY)       |
| `--metrics-port <n>` | (Future) metrics server starting port       |
| `--dump-config`      | Print merged configuration & exit           |
| `--dry-run`          | Validate config then exit (no start)        |

## 🔄 Learning & Normalization

Unknown commands append to `learnCandidates.jsonl`. Approved patterns populate SAFE cache (future auto-promotion pipeline). Early phases rely on manual curation.

## 🧾 Logging & Audit

- Structured audit logs written to `logs/` (date rotated)
- NDJSON stream for ingestion
- Metrics registry (internal); future: HTTP exposition (Prometheus style)

## 🛡 Hardening Roadmap (Excerpt)

1. Expand classification signatures
2. Configurable allow/deny per category
3. Sandboxed file roots & network egress gating
4. Per-level rate limiting / quotas
5. Multi-tenant auth & per-key usage metrics

See `docs/HARDENING-DESIGN.md` for details.

## 🤝 Contributing

1. Fork & branch (`feat/<name>`)
2. `npm install && npm run build`
3. Add / update tests
4. Ensure hooks pass
5. Open PR with concise summary & risk notes

Refer to `CONTRIBUTING.md` & `CODE_OF_CONDUCT.md`.

## 📄 License

See `LICENSE`.

## 📬 Support / Questions

Open a GitHub Issue (choose a template) or read `docs/TROUBLESHOOTING.md`.

---
**Status:** Phase 1 foundation. Interfaces & configuration may evolve (semantic versioning respected for published releases).

