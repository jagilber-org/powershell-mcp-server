# PowerShell MCP Server - Technical Plan

## Technical Context

### Language & Runtime
- **Primary Language**: TypeScript 5.3+
- **Runtime**: Node.js 18.x LTS (minimum), Node.js 20.x recommended
- **PowerShell Integration**: PowerShell 7.2+ via child process execution
- **Build System**: tsc (TypeScript compiler)
- **Package Manager**: npm 9+

### Key Dependencies
- **@modelcontextprotocol/sdk** (^1.0.0): MCP protocol implementation
- **zod** (^3.22.0): Runtime type validation and schema definition
- **edge-runtime** (^2.0.0): PowerShell host process management

### Development Dependencies
- **jest** (^29.0.0): Testing framework with 90%+ coverage target
- **@types/jest** (^29.0.0): TypeScript definitions
- **ts-jest** (^29.0.0): Jest TypeScript preprocessor
- **eslint** (^8.0.0): Code quality and style enforcement
- **prettier** (^3.0.0): Code formatting
- **husky** (^8.0.0): Git hooks management

### Platform Constraints
- **Target Platforms**: Windows 10/11 (primary), Windows Server 2016+ (tested), Linux/macOS (experimental)
- **Architectures**: x86_64, ARM64
- **Minimum RAM**: 512MB (2GB recommended for high-load scenarios)
- **Disk Space**: ~100MB for installation
- **PowerShell Requirements**: PowerShell 7.x installed and in PATH

### External Systems Integration
- **Windows Event Log**: Optional audit log integration
- **File System**: Audit logs (NDJSON), metrics snapshots, working directory policy enforcement
- **HTTP Server**: Metrics dashboard (port 9300 default)
- **No database requirements**: Stateless operation with optional file-based state

## Project Structure

`
powershell-mcp-server/
├── src/
│   ├── index.ts                  # MCP server entry point
│   ├── server.ts                 # Core server implementation
│   ├── security/
│   │   ├── classifier.ts         # Security classification engine
│   │   ├── patterns.ts           # Severity patterns and rules
│   │   ├── override.ts           # Dynamic pattern management
│   │   └── working-directory.ts  # Path policy enforcement
│   ├── execution/
│   │   ├── executor.ts           # PowerShell execution orchestrator
│   │   ├── timeout.ts            # Adaptive timeout management
│   │   ├── hang-detection.ts    # Hang detection logic
│   │   └── runspace-pool.ts     # PowerShell host pooling
│   ├── tools/
│   │   ├── run-powershell.ts    # MCP tool: Execute commands
│   │   ├── validate-syntax.ts   # MCP tool: Syntax checking
│   │   ├── get-help.ts           # MCP tool: Help retrieval
│   │   ├── security-classify.ts  # MCP tool: Classification
│   │   ├── security-override.ts  # MCP tool: Pattern updates
│   │   ├── health-check.ts       # MCP tool: Health status
│   │   ├── emit-log.ts           # MCP tool: Audit logging
│   │   └── server-stats.ts       # MCP tool: Metrics snapshot
│   ├── observability/
│   │   ├── metrics.ts            # Metrics registry
│   │   ├── dashboard.ts          # HTTP/SSE server for dashboard
│   │   ├── audit-logger.ts       # NDJSON audit logging
│   │   └── threat-tracker.ts     # Alias/threat detection
│   ├── auth/
│   │   ├── validator.ts          # API key validation
│   │   ├── bootstrap.ts          # First-run confirmation tokens
│   │   └── rate-limiter.ts       # Token bucket rate limiting
│   ├── types/
│   │   ├── mcp-schemas.ts        # Zod schemas for MCP tools
│   │   ├── security-types.ts     # Classification types
│   │   ├── execution-types.ts    # Execution result types
│   │   └── metrics-types.ts      # Observability types
│   └── utils/
│       ├── logger.ts             # Logging utility
│       ├── config-loader.ts      # Enterprise config management
│       └── signal-handler.ts     # Graceful shutdown
├── __tests__/
│   ├── unit/
│   │   ├── security-classifier.test.ts  # Classification tests
│   │   ├── timeout-management.test.ts   # Timeout/hang tests
│   │   ├── rate-limiter.test.ts         # Rate limit tests
│   │   └── pattern-matching.test.ts     # Pattern detection tests
│   ├── integration/
│   │   ├── mcp-tools.test.ts            # End-to-end MCP tool tests
│   │   ├── adaptive-timeout.test.ts     # Adaptive extension tests
│   │   ├── security-override.test.ts    # Dynamic pattern tests
│   │   └── metrics-dashboard.test.ts    # Observability tests
│   └── fixtures/
│       ├── safe-commands.ps1            # Test data: safe commands
│       ├── dangerous-commands.ps1       # Test data: dangerous commands
│       └── expected-classifications.json # Expected security outcomes
├── docs/
│   ├── specs/
│   │   ├── spec.md                      # THIS: Product specification
│   │   └── plan.md                      # THIS: Technical plan
│   ├── ARCHITECTURE.md                  # System architecture (Mermaid diagrams)
│   ├── PRODUCT-REQUIREMENTS.md          # Original PRD (v1.0)
│   ├── SECURITY.md                      # Security policy (TO BE CREATED)
│   ├── API.md                           # MCP tool API reference (TO BE CREATED)
│   ├── HARDENING-DESIGN.md              # Security hardening details
│   ├── TROUBLESHOOTING.md               # Common issues and solutions
│   ├── USAGE-EXAMPLES.md                # Practical usage examples
│   ├── KNOWLEDGE-INDEX.md               # Documentation index
│   ├── AGENT-PROMPTS.md                 # AI agent guidance
│   ├── CLASSIFICATION.md                # Classification system details
│   ├── CRITICAL-TIMEOUT-COMMANDS.md     # Timeout-sensitive commands
│   └── LEARNING.md                      # Command learning system
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                       # CI pipeline with security scanning
│   │   └── dependabot.yml               # Dependency updates
│   └── CODEOWNERS                       # Code review ownership
├── README.md                            # Project overview and quickstart
├── package.json                         # NPM package configuration
├── tsconfig.json                        # TypeScript compiler config
├── jest.config.js                       # Jest testing configuration
└── .pre-commit-config.yaml              # Pre-commit hooks
`

## Architecture

> **Note**: For comprehensive architecture diagrams, see [docs/ARCHITECTURE.md](../ARCHITECTURE.md) which includes:
> - High-level component architecture (Mermaid flowchart)
> - Request lifecycle sequence diagrams
> - Security classification decision tree
> - Timeout management state machine
> - Metrics and observability flows

### Security Classification Architecture

`
┌─────────────────────────────────────────────────────────┐
│               PowerShell Command Input                  │
│              (from AI agent via MCP)                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────┐
│            Pattern-Based Classifier                     │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │   Verb     │  │   Flags    │  │   Path Analysis  │  │
│  │  Analysis  │─▶│  Detection │─▶│   (C:\Windows)   │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────┐
│         Severity Level Assignment                       │
│  SAFE → LOW → MEDIUM → HIGH → CRITICAL                  │
│  (Get-*) (Set-Var) (Stop-Proc) (Remove) (Format)        │
└────────────────────┬────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────┐
│         Execution Classification                        │
│  - SAFE: Execute immediately                            │
│  - GUARDED: Require confirmation (confirmed=true)       │
│  - BLOCKED: Reject execution                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────┐
│    Dynamic Pattern Override (if configured)             │
│  - Session-specific overrides                           │
│  - Persisted overrides from enterprise policy           │
└─────────────────────────────────────────────────────────┘
`

### Adaptive Timeout Architecture

`
┌─────────────────────────────────────────────────────────┐
│          PowerShell Execution Start                     │
│          (initialTimeoutMs = 30000)                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────┐
│        Monitor Output Stream (stdio/stderr)             │
│        Check progress every 1 second                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     v
            ┌────────┴──────────┐
            │  New output?      │
            └────────┬──────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
       YES                       NO
        │                         │
        v                         v
┌──────────────┐          ┌──────────────────┐
│ Reset Timer  │          │ Check Timeout    │
│ Continue     │          │ Reached 80%?     │
└──────────────┘          └────────┬─────────┘
                                   │
                          ┌────────┴──────────┐
                          │                   │
                         YES                 NO
                          │                   │
                          v                   v
               ┌──────────────────┐    ┌────────────┐
               │ Hang Detected?   │    │ Continue   │
               │ (no output)      │    │ Monitoring │
               └────────┬─────────┘    └────────────┘
                        │
               ┌────────┴────────┐
               │                 │
              YES               NO
               │                 │
               v                 v
      ┌────────────┐    ┌────────────────┐
      │ Kill Proc  │    │ Extend Timeout │
      │ Return     │    │ (if < 3 exts)  │
      │ TIMEOUT    │    │ Add +30s       │
      └────────────┘    └────────────────┘
                                │
                                v
                      ┌──────────────────┐
                      │ terminationReason│
                      │ = adaptive_ext'd │
                      └──────────────────┘
`

### Observability & Metrics Architecture

`
┌─────────────────────────────────────────────────────────┐
│               Execution Events                          │
│  (command executed, blocked, timed out, etc.)           │
└────────────────────┬────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────┐
│          Metrics Registry (In-Memory)                   │
│  - Executions per minute                                │
│  - Latency distribution (p50, p95, p99)                 │
│  - Security block counts by severity                    │
│  - Timeout/hang counts                                  │
│  - Rate limit status                                    │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          v                     v
┌──────────────────┐   ┌────────────────────┐
│  HTTP Server     │   │  Audit Logger      │
│  (Port 9300)     │   │  (NDJSON Files)    │
└────────┬─────────┘   └────────────────────┘
         │
    ┌────┴────┐
    │         │
    v         v
┌────────┐ ┌─────────┐
│  SSE   │ │  JSON   │
│ Stream │ │ Snapshot│
└────────┘ └─────────┘
    │           │
    v           v
┌────────────────────┐
│ Browser Dashboard  │
│ (Real-time Charts) │
└────────────────────┘
`

## Implementation Phases

> **Current Status**: Phase 7 (Portfolio Preparation) - All core functionality complete, adding GitHub spec-kit documentation

### Phase 1: Foundation (COMPLETE) - Weeks 1-4
**Goal**: Establish MCP server infrastructure and PowerShell integration

**Completed Tasks:**
- ✅ Set up TypeScript project with MCP SDK integration
- ✅ Implement basic MCP server lifecycle (ListTools, CallTool)
- ✅ Create PowerShell executor with child process management
- ✅ Write unit tests for core functionality
- ✅ Set up CI pipeline with automated testing

**Deliverables:**
- ✅ Working MCP server accepting un_powershell tool calls
- ✅ PowerShell 7.x integration
- ✅ Comprehensive test suite (90%+ coverage)

### Phase 2: Security Classification (COMPLETE) - Weeks 5-8
**Goal**: Implement robust command security assessment

**Completed Tasks:**
- ✅ Build pattern-based security classifier
- ✅ Implement severity levels (SAFE → CRITICAL)
- ✅ Add confirmation requirement for dangerous commands
- ✅ Create security_classify MCP tool
- ✅ Integration tests for classification accuracy

**Deliverables:**
- ✅ Multi-tier security classification system
- ✅ <10ms classification performance
- ✅ 0% false positives on safe commands

### Phase 3: Timeout & Hang Management (COMPLETE) - Weeks 9-12
**Goal**: Deterministic execution termination with adaptive extension

**Completed Tasks:**
- ✅ Implement adaptive timeout system
- ✅ Add hang detection (80% threshold, no output)
- ✅ Create 	erminationReason enum
- ✅ Add ffectiveTimeoutMs and daptiveExtensions fields
- ✅ Extensive timeout/hang testing (100 consecutive CI runs)

**Deliverables:**
- ✅ Adaptive timeout with 70%+ success rate on progressive tasks
- ✅ 0 false hang detections
- ✅ Clear termination reasons for all executions

### Phase 4: Dynamic Security Patterns (COMPLETE) - Weeks 13-16
**Goal**: Enable runtime security policy updates

**Completed Tasks:**
- ✅ Implement security_override_patterns tool
- ✅ Add session-scoped and persisted overrides
- ✅ Audit logging for pattern changes
- ✅ Hot-reload without server restart

**Deliverables:**
- ✅ Dynamic pattern updates <100ms
- ✅ No service interruption during updates
- ✅ Comprehensive override tests

### Phase 5: Observability & Metrics (COMPLETE) - Weeks 17-20
**Goal**: Real-time visibility into server operations

**Completed Tasks:**
- ✅ Build metrics registry with in-memory aggregation
- ✅ Create HTTP/SSE server for dashboard
- ✅ Implement NDJSON audit logging
- ✅ Add health_check, mit_log, server_stats tools
- ✅ Browser-based metrics dashboard

**Deliverables:**
- ✅ Real-time metrics dashboard (port 9300)
- ✅ <500ms SSE update latency
- ✅ 100% execution audit coverage

### Phase 6: Rate Limiting & Auth (COMPLETE) - Weeks 21-24
**Goal**: Production-grade authentication and DoS protection

**Completed Tasks:**
- ✅ Implement token bucket rate limiter
- ✅ Add API key authentication
- ✅ Bootstrap confirmation token system
- ✅ Audit logging for auth failures
- ✅ Rate limit tests and stress testing

**Deliverables:**
- ✅ 100 requests per 60 seconds default limit
- ✅ Per-client tracking
- ✅ Clear rate limit error messages

### Phase 7: Portfolio Preparation (IN PROGRESS) - Week 25
**Goal**: Professional documentation for resume showcase

**Current Tasks:**
- ✅ Create GitHub spec-kit formatted spec.md
- 🔄 Create plan.md (THIS DOCUMENT)
- ⏳ Create SECURITY.md with PowerShell security model
- ⏳ Create API.md with comprehensive MCP tool reference
- ⏳ Update README to reference specs/

**Deliverables:**
- ⏳ Complete documentation suite following GitHub patterns
- ⏳ Cross-references between all documentation
- ⏳ Portfolio-ready presentation

### Phase 8: Future Enhancements (ROADMAP)
**Goal**: Advanced features for enterprise adoption

**Planned Features:**
- Command learning suggestions (US-007)
- Cancellation RPC for long-running commands
- Per-user quota enforcement
- Metrics counters per terminationReason
- External policy plugin injection
- PowerShell DSC integration

**Timeline**: TBD based on community feedback

## Constitution Check

### Project Alignment
✅ **Aligns with MCP ecosystem**: Bridges AI intelligence with Windows/PowerShell automation  
✅ **Solves real problems**: Enterprise security for AI agent operations is critical  
✅ **Demonstrates expertise**: Security, observability, performance optimization, protocol implementation  
✅ **Portfolio showcase**: 290+ hours investment, production-ready enterprise tooling

### Technical Soundness
✅ **TypeScript best practices**: Strict mode, comprehensive types, Zod validation  
✅ **Testing rigor**: 90%+ coverage target, 100 consecutive CI runs for timeout tests  
✅ **Security by design**: Multi-tier classification, audit logging, rate limiting  
✅ **Performance conscious**: <10ms classification, <5% overhead vs native PowerShell

### Documentation Excellence
✅ **Comprehensive existing docs**: ARCHITECTURE.md, PRODUCT-REQUIREMENTS.md, TROUBLESHOOTING.md, USAGE-EXAMPLES.md  
✅ **Mermaid diagrams**: Component architecture, sequence diagrams, state machines  
✅ **AI agent guidance**: AGENT-PROMPTS.md for intelligent tool usage  
✅ **Knowledge index**: KNOWLEDGE-INDEX.md for documentation discovery

### Risks & Mitigation

**Risk 1: PowerShell Version Compatibility**
- **Mitigation**: Target PowerShell 7.2+ (LTS), test on 7.2, 7.3, 7.4
- **Mitigation**: Feature detection rather than version checks
- **Mitigation**: Graceful degradation for unsupported features

**Risk 2: False Positive Security Blocks**
- **Mitigation**: Confidence scoring in classification
- **Mitigation**: Dynamic pattern overrides for organization-specific needs
- **Mitigation**: Comprehensive test dataset with edge cases

**Risk 3: Performance Degradation Under Load**
- **Mitigation**: Runspace pooling for concurrent executions
- **Mitigation**: Memory limits and resource cleanup
- **Mitigation**: Stress testing at 1000 executions/min

**Risk 4: Audit Log Disk Exhaustion**
- **Mitigation**: Automatic log rotation (size-based)
- **Mitigation**: Configurable log retention policies
- **Mitigation**: Log compression for archived logs

## Success Criteria

**Technical Excellence:**
- ✅ All tests passing with 90%+ coverage
- ✅ Zero high-severity security vulnerabilities
- ✅ Performance targets met (<10ms classification, <5% overhead)
- ✅ 100 consecutive CI runs without false hang detections

**Portfolio Presentation:**
- ✅ Professional documentation suite (in progress)
- ✅ Mermaid architecture diagrams included
- ✅ GitHub Actions CI showing green builds
- 🔄 GitHub spec-kit compliance (spec.md, plan.md, SECURITY.md, API.md)

**Community Validation:**
- ⏳ 100+ GitHub stars within 6 months (future goal)
- ⏳ Used by enterprise AI teams (future goal)
- ⏳ No security incidents reported (ongoing)

## Cross-References

**Related Documentation:**
- [Product Specification (spec.md)](./spec.md) - User scenarios and functional requirements
- [Architecture (ARCHITECTURE.md)](../ARCHITECTURE.md) - Mermaid diagrams and detailed architecture
- [Original PRD (PRODUCT-REQUIREMENTS.md)](../PRODUCT-REQUIREMENTS.md) - V1.0 requirements
- [Security Hardening (HARDENING-DESIGN.md)](../HARDENING-DESIGN.md) - Security implementation details
- [Troubleshooting (TROUBLESHOOTING.md)](../TROUBLESHOOTING.md) - Common issues and solutions
- [Usage Examples (USAGE-EXAMPLES.md)](../USAGE-EXAMPLES.md) - Practical command examples
- [Agent Prompts (AGENT-PROMPTS.md)](../AGENT-PROMPTS.md) - AI agent guidance
- [Knowledge Index (KNOWLEDGE-INDEX.md)](../KNOWLEDGE-INDEX.md) - Documentation navigation

## Timeline

**Total Duration**: 25 weeks (290+ hours WakaTime investment)

- Weeks 1-4: Foundation (MCP + PowerShell integration) ✅
- Weeks 5-8: Security classification ✅
- Weeks 9-12: Timeout & hang management ✅
- Weeks 13-16: Dynamic security patterns ✅
- Weeks 17-20: Observability & metrics ✅
- Weeks 21-24: Rate limiting & authentication ✅
- Week 25: Portfolio preparation 🔄
- Future: Community feedback and enhancements ⏳

**Current Status**: Phase 7 (Portfolio Preparation) - Creating GitHub spec-kit documentation

## Revision History

- 2025-12-22: Initial GitHub spec-kit format technical plan (v1.0.0)
- Portfolio preparation: Extracted from existing ARCHITECTURE.md and PRODUCT-REQUIREMENTS.md
- Added comprehensive architecture diagrams and cross-references
- Organized into GitHub spec-kit structure with phased implementation
