# PowerShell MCP Server

> **Portfolio Project** | [View Full Portfolio](https://github.com/jagilber-org) | [Specifications](docs/specs/)

Enterprise-ready Model Context Protocol (MCP) server exposing secure, policy-aware PowerShell automation and supporting tooling (syntax analysis, metrics, audit, deployment helpers). Designed for AI agent integration, reproducible observability, and progressive hardening.

## 🔐 Security Notice

This repository follows [GitHub Spec-Kit](https://github.com/ambie-inc) security standards:

- **Pre-commit hooks**: Prevents accidental commit of credentials, API keys, and sensitive configuration
- **Environment variables**: Use `.env.example` as template, never commit actual `.env`
- **Config files**: `config/*.example.json` files are templates; actual config files are gitignored
- **Auth keys**: Never commit `MCP_AUTH_KEY` values or authentication tokens
- **PowerShell scripts**: All examples use placeholder paths (e.g., `C:\Example\Path`, generic commands)
- **Learned patterns**: Sanitize `data/learned-safe.json` before committing (use generic command examples)
- **Audit logs**: All `logs/*.log` files are gitignored (may contain command history)

**PowerShell Safety**:
- Commands classified by security level (SAFE → RISKY → DANGEROUS → BLOCKED)
- RISKY/UNKNOWN commands require explicit `confirmed: true` in API calls
- All PowerShell execution is audited with timestamps and safety classifications

**For contributors**: Review security guidelines in the Contributing section before making changes.

---

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

## Portfolio Context

This project is part of the [jagilber-org portfolio](https://github.com/jagilber-org), demonstrating enterprise-grade MCP server development.

**Cross-Project Integration**:
- Foundation for **kusto-dashboard-manager** PowerShell automation
- Powers **obfuscate-mcp-server** file operations and transformations
- Enables **chrome-screenshot-sanitizer** configuration management
- Reference implementation for secure PowerShell MCP integration

**Portfolio Highlights**:
- Production-ready security classification system (SAFE → DANGEROUS → BLOCKED)
- Enterprise configuration management patterns
- Comprehensive test coverage (50+ Jest tests)
- Progressive hardening and audit logging
- TypeScript MCP server architecture

[View Full Portfolio](https://github.com/jagilber-org) | [Integration Examples](https://github.com/jagilber-org#cross-project-integration)

## 🚀 Quick Start

### First-Time Setup

**Prerequisites:**
- Node.js 18 or higher
- PowerShell 5.1+ (Windows) or PowerShell Core 7+ (cross-platform)
- TypeScript 5+ (installed via npm)
- VS Code recommended for development

**Initial Setup:**

```bash
# Clone the repository
git clone https://github.com/jagilber-org/powershell-mcp-server.git
cd powershell-mcp-server

# Install dependencies
npm install

# Build the TypeScript source
npm run build

# Verify build completed successfully
ls dist/  # Should show compiled JavaScript files
```

**Optional: Configure Authentication:**

```powershell
# Windows PowerShell
$env:MCP_AUTH_KEY="your-strong-key-here"

# Windows Command Prompt
set MCP_AUTH_KEY=your-strong-key-here

# Linux/macOS
export MCP_AUTH_KEY="your-strong-key-here"
```

**Start the MCP Server:**

```bash
npm start            # Starts MCP server with default configuration
```

**Verify Installation:**

```bash
# Check configuration
node dist/cli.js --dump-config

# Test syntax checker
node dist/cli.js --no-metrics --dry-run
```

### Basic Usage

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
| run_powershell         | Execute PowerShell                   | Classified; needs `confirmed:true` if RISKY/UNKNOWN          |
| powershell_syntax_check| Parse & (optional) analyze script    | Native parser + optional analyzer via env                   |
| server_stats           | Metrics / threat snapshot            | Read-only                                                   |
| audit / admin (future) | Administrative introspection         | Gated                                                       |

Breaking Change: Legacy hyphenated name `run-powershell` removed. Use `run_powershell` and underscore parameter names (`aiAgentTimeoutSec`, etc.).

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

### Code Standards

This project follows strict TypeScript and PowerShell development standards:

- **TypeScript Strict**: All code uses TypeScript strict mode with full type safety
- **ESLint Configuration**: Follow ESLint rules defined in `.eslintrc.js`
- **PowerShell Best Practices**: Use approved verbs, proper error handling, comment-based help
- **Testing**: All features require Jest test coverage before merge (maintain 50+ passing tests)
- **MCP Compliance**: Follow Model Context Protocol specifications (JSON-RPC 2.0)
- **Security Classification**: All PowerShell commands must have security level classification
- **Code Review**: All changes undergo peer review

**Testing Requirements:**
- Run `npm run test:jest` before committing
- Add tests for new MCP tools and PowerShell patterns
- Test security classification for new command patterns
- Verify pre-commit hooks pass (no skipped tests)

**Build Process:**
```bash
npm install              # Install dependencies
npm run build           # Compile TypeScript
npm run test:jest       # Run test suite
node dist/cli.js --dump-config  # Verify configuration
```

### Repository Ownership Policy

This repository follows strict contribution guidelines per [GitHub Spec-Kit](https://github.com/ambie-inc) standards:

- **No automatic PRs**: Contributors must have explicit permission before creating pull requests
- **Manual review required**: All contributions undergo code review and security audit
- **Testing mandatory**: All changes must pass Jest test suite and add appropriate test coverage
- **Documentation required**: Update relevant documentation with changes

**Before contributing:**
1. Open an issue to discuss proposed changes
2. Wait for maintainer approval
3. Follow code standards and testing requirements
4. Ensure all CI checks pass

### Documentation Standards

**IMPORTANT**: Follow these documentation practices:

- ✅ **Use placeholder values** in all examples:
  - File paths: `C:\Example\Path\script.ps1`, `/home/user/example/`
  - Commands: `Get-Example`, `Write-SampleOutput`, generic cmdlets
  - Module names: `ExampleModule`, `SamplePowerShellModule`
  - Auth keys: `your-strong-key-here`, `example-auth-key-123`
  - URLs: `https://example.com`, `http://api.example.org`
  - Server names: `example-server`, `contoso.local`

- ❌ **Never include**:
  - Real credentials, API keys, or auth tokens
  - Actual file paths from development machines
  - Production server names or internal hostnames
  - Company-specific PowerShell modules or scripts
  - Personal information or actual usernames
  - Real command history from audit logs

- ✅ **Do document**:
  - Security classification levels and criteria
  - Configuration options and environment variables
  - MCP tool parameters and response formats
  - PowerShell execution patterns and best practices
  - Error handling and timeout behavior

**Security in Documentation:**
- Review security guidelines before documenting features
- Never document internal security bypass mechanisms
- Use generic examples for PowerShell command patterns
- Sanitize any logs or traces containing command history
- Redact learned-safe.json examples (use generic commands)

### Development Workflow

1. **Fork the repository**

2. **Create a feature branch**:

   ```bash
   git checkout -b feat/my-new-feature
   ```

3. **Make your changes**:
   - Write code following existing style (TypeScript strict mode)
   - Add security classification for new PowerShell patterns
   - Add tests for new functionality
   - Update documentation

4. **Run tests**:

   ```bash
   npm run test:jest
   ```

5. **Commit changes**:

   ```bash
   git commit -am "feat: Add new feature description"
   ```

6. **Push to your fork**:

   ```bash
   git push origin feat/my-new-feature
   ```

7. **Create Pull Request**

Refer to `CONTRIBUTING.md` & `CODE_OF_CONDUCT.md` for detailed guidelines.

## 📄 License

See `LICENSE`.

## 📬 Support / Questions

Open a GitHub Issue (choose a template) or read `docs/TROUBLESHOOTING.md`.

## 📚 Documentation

### Specifications

- **[Product Specification](docs/specs/spec.md)** - User scenarios, functional requirements, success criteria, integration points
- **[Technical Plan](docs/specs/plan.md)** - Architecture, implementation phases, performance benchmarks

### Project Documentation

- [Full Documentation Index](docs/) - Comprehensive guides and references

---
**Status:** Phase 1 foundation. Interfaces & configuration may evolve (semantic versioning respected for published releases).
