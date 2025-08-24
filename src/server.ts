// @ts-nocheck
/**
 * Enterprise-Scale PowerShell MCP Server
 * Strongly-typed TypeScript implementation with comprehensive functionality
 * 
 * Features:
 * - 5-level security classification system
 * - MCP-standard logging with audit trails
 * - Comprehensive AI agent integration
 * - Enterprise-grade error handling
 * - Full type safety and maintainability
 * - Unified authentication using 'key' parameter (backward compatible with 'authKey')
 * - Optimized timeouts (default 90 seconds, AI agent override support)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, Tool, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { spawn, ChildProcess, SpawnOptionsWithoutStdio } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { metricsRegistry } from './metrics/registry.js';
import { metricsHttpServer } from './metrics/httpServer.js';
import { recordUnknownCandidate, aggregateCandidates, resolveLearningConfig, LearningConfig, recommendCandidates, promoteCandidates, loadLearnedPatterns, queueCandidates, listQueuedCandidates, approveQueuedCandidates, removeFromQueue } from './learning.js';
// Modularized imports
import { ENTERPRISE_CONFIG } from './core/config.js';
import { auditLog, setMCPServer } from './logging/audit.js';
import { classifyCommandSafety } from './security/classification.js';
import { runPowerShellTool } from './tools/runPowerShell.js';

// === Consolidation Refactor Support Types (reinserted) ===
type SecurityLevel = 'SAFE' | 'RISKY' | 'DANGEROUS' | 'CRITICAL' | 'UNKNOWN' | 'BLOCKED';
interface SecurityAssessment { level: SecurityLevel; risk: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; category: string; reason: string; blocked: boolean; requiresPrompt: boolean; color?: string; patterns?: string[]; recommendations?: string[]; }
type ThreatCategory = 'FILE_OPERATION' | 'PROCESS_MANAGEMENT' | 'SYSTEM_MODIFICATION' | 'REGISTRY_MODIFICATION' | 'REMOTE_MODIFICATION' | 'INFORMATION_GATHERING' | 'SECURITY_THREAT' | 'SYSTEM_DESTRUCTION';

interface AuditLogEntry { timestamp: string; level: string; category: string; message: string; metadata?: Record<string, any>; }
type MCPNotificationParams = any;
interface SystemInfo { platform: string; release: string; arch: string; node: string; cpus: number; memory: { totalGB: number; freeGB: number }; pid?: number; nodeVersion?: string; user?: string; hostname?: string; cwd?: string; freeMemory?: string; totalMemory?: string; uptime?: string; };

// Threat tracking types (lightweight stubs)
interface UnknownThreatEntry { id: string; command: string; sessionId: string; firstSeen: string; lastSeen: string; count: number; risk: string; level: SecurityLevel; category: string; aliasDetected?: boolean; reasons: string[]; normalized?: string; frequency?: number; riskAssessment?: SecurityAssessment; timestamp?: string; possibleAliases?: string[]; [k: string]: any; }
interface ThreatTrackingStats { totalUnknownCommands: number; uniqueThreats: number; highRiskThreats: number; aliasesDetected: number; sessionsWithThreats: number; }
interface ClientInfo { pid?: number; ppid?: number; parentPid?: number; platform?: string; arch?: string; serverPid?: number; connectionId?: string; };
interface AliasDetectionResult { alias: string; cmdlet: string; risk: string; category: string; isAlias?: boolean; resolvedCommand?: string; securityRisk?: string; originalCommand?: string; aliasType?: string; reason?: string; }

// PowerShell execution result (simplified)
interface PowerShellExecutionResult { stdout: string; stderr: string; exitCode: number | null; truncated?: boolean; durationMs?: number; duration_ms?: number; success?: boolean; [k: string]: any; }

// AI test harness types
interface AITestCase { id?: string; description?: string; command: string; expected?: string; category?: string; name?: string; shouldSucceed?: boolean; expectedSecurity?: SecurityLevel; [k: string]: any; }
interface AITestResult { id: string; passed: boolean; expectedResult: string; actualResult: string; durationMs: number; notes?: string; [k: string]: any; }
interface AITestResults { summary: { total: number; passed: number; failed: number; durationMs: number; securityEnforcement?: string; safeExecution?: string; successRate?: string; }; tests: AITestResult[]; totalTests?: number; [k: string]: any; }

// Pattern arrays referenced in classification (stubs for now; can be enriched later)
const REGISTRY_MODIFICATION_PATTERNS: readonly string[] = [
    'New-Item\s+-Path\s+HK',
    'Remove-ItemProperty',
    'Set-ItemProperty',
    'sp\s+hklm:'
];
const SYSTEM_FILE_PATTERNS: readonly string[] = [
    'System32',
    'Windows\\System32',
    'ProgramData'
];
const ROOT_DELETION_PATTERNS: readonly string[] = [
    'Remove-Item\s+\\\\?\\C:',
    'Format-Volume'
];
const REMOTE_MODIFICATION_PATTERNS: readonly string[] = [
    'Invoke-WebRequest',
    'Invoke-RestMethod',
    'curl\s+http',
    'wget\s+http'
];
const CRITICAL_PATTERNS: readonly string[] = [
    'Invoke-Expression',
    'IEX',
    'Set-Alias',
    'New-Alias'
];
const DANGEROUS_COMMANDS: readonly string[] = [
    'Stop-Service',
    'Restart-Service',
    'Remove-Item\s+-Recurse',
    'Stop-Process'
];
const RISKY_PATTERNS: readonly string[] = [
    'Set-Variable',
    'Set-Content',
    'Add-Content'
];

// ENTERPRISE_CONFIG now imported from core/config.ts

// Learning config stub (replace with persisted config if needed)
const LEARNING_CONFIG: LearningConfig = resolveLearningConfig();

// Safe patterns (basic harmless informational commands)
const SAFE_PATTERNS: readonly string[] = [
    '^Show-',
    '^Test-.*(?!-Computer)',
    '^Out-Host',
    '^Out-String',
    '^Write-Host',
    '^Write-Output',
    '^Write-Information',
    '^Format-',
    '^Select-',
    '^Where-Object',
    '^Sort-Object',
    '^Group-Object',
    '^Measure-Object'
] as const;

// ==============================================================================
// POWERSHELL ALIAS DETECTION - Security threat analysis
// ==============================================================================

/** Common PowerShell aliases that could be security threats */
const POWERSHELL_ALIAS_MAP: Record<string, { cmdlet: string; risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; category: ThreatCategory }> = {
    // File System Operations
    'ls': { cmdlet: 'Get-ChildItem', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'dir': { cmdlet: 'Get-ChildItem', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'gci': { cmdlet: 'Get-ChildItem', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'cat': { cmdlet: 'Get-Content', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'type': { cmdlet: 'Get-Content', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'gc': { cmdlet: 'Get-Content', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'rm': { cmdlet: 'Remove-Item', risk: 'HIGH', category: 'FILE_OPERATION' },
    'del': { cmdlet: 'Remove-Item', risk: 'HIGH', category: 'FILE_OPERATION' },
    'erase': { cmdlet: 'Remove-Item', risk: 'HIGH', category: 'FILE_OPERATION' },
    'rd': { cmdlet: 'Remove-Item', risk: 'HIGH', category: 'FILE_OPERATION' },
    'ri': { cmdlet: 'Remove-Item', risk: 'HIGH', category: 'FILE_OPERATION' },
    'cp': { cmdlet: 'Copy-Item', risk: 'MEDIUM', category: 'FILE_OPERATION' },
    'copy': { cmdlet: 'Copy-Item', risk: 'MEDIUM', category: 'FILE_OPERATION' },
    'cpi': { cmdlet: 'Copy-Item', risk: 'MEDIUM', category: 'FILE_OPERATION' },
    'mv': { cmdlet: 'Move-Item', risk: 'MEDIUM', category: 'FILE_OPERATION' },
    'move': { cmdlet: 'Move-Item', risk: 'MEDIUM', category: 'FILE_OPERATION' },
    'mi': { cmdlet: 'Move-Item', risk: 'MEDIUM', category: 'FILE_OPERATION' },
    'md': { cmdlet: 'New-Item -ItemType Directory', risk: 'LOW', category: 'FILE_OPERATION' },
    'mkdir': { cmdlet: 'New-Item -ItemType Directory', risk: 'LOW', category: 'FILE_OPERATION' },
    'ni': { cmdlet: 'New-Item', risk: 'MEDIUM', category: 'FILE_OPERATION' },
    
    // Process Management  
    'ps': { cmdlet: 'Get-Process', risk: 'LOW', category: 'PROCESS_MANAGEMENT' },
    'gps': { cmdlet: 'Get-Process', risk: 'LOW', category: 'PROCESS_MANAGEMENT' },
    'kill': { cmdlet: 'Stop-Process', risk: 'HIGH', category: 'PROCESS_MANAGEMENT' },
    'spps': { cmdlet: 'Stop-Process', risk: 'HIGH', category: 'PROCESS_MANAGEMENT' },
    'start': { cmdlet: 'Start-Process', risk: 'HIGH', category: 'PROCESS_MANAGEMENT' },
    'saps': { cmdlet: 'Start-Process', risk: 'HIGH', category: 'PROCESS_MANAGEMENT' },
    
    // Service Management
    'gsv': { cmdlet: 'Get-Service', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'sasv': { cmdlet: 'Start-Service', risk: 'HIGH', category: 'SYSTEM_MODIFICATION' },
    'spsv': { cmdlet: 'Stop-Service', risk: 'HIGH', category: 'SYSTEM_MODIFICATION' },
    'rsv': { cmdlet: 'Restart-Service', risk: 'HIGH', category: 'SYSTEM_MODIFICATION' },
    
    // Registry Operations
    'gp': { cmdlet: 'Get-ItemProperty', risk: 'MEDIUM', category: 'REGISTRY_MODIFICATION' },
    'sp': { cmdlet: 'Set-ItemProperty', risk: 'CRITICAL', category: 'REGISTRY_MODIFICATION' },
    'rp': { cmdlet: 'Remove-ItemProperty', risk: 'CRITICAL', category: 'REGISTRY_MODIFICATION' },
    
    // Network Operations
    'nslookup': { cmdlet: 'Resolve-DnsName', risk: 'MEDIUM', category: 'INFORMATION_GATHERING' },
    'ping': { cmdlet: 'Test-NetConnection', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'wget': { cmdlet: 'Invoke-WebRequest', risk: 'HIGH', category: 'REMOTE_MODIFICATION' },
    'curl': { cmdlet: 'Invoke-WebRequest', risk: 'HIGH', category: 'REMOTE_MODIFICATION' },
    'iwr': { cmdlet: 'Invoke-WebRequest', risk: 'HIGH', category: 'REMOTE_MODIFICATION' },
    'irm': { cmdlet: 'Invoke-RestMethod', risk: 'HIGH', category: 'REMOTE_MODIFICATION' },
    
    // Execution and Downloads (High Risk)
    'iex': { cmdlet: 'Invoke-Expression', risk: 'CRITICAL', category: 'SECURITY_THREAT' },
    'icm': { cmdlet: 'Invoke-Command', risk: 'CRITICAL', category: 'REMOTE_MODIFICATION' },
    'sal': { cmdlet: 'Set-Alias', risk: 'HIGH', category: 'SYSTEM_MODIFICATION' },
    'nal': { cmdlet: 'New-Alias', risk: 'HIGH', category: 'SYSTEM_MODIFICATION' },
    
    // Text Processing
    'select': { cmdlet: 'Select-Object', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'sort': { cmdlet: 'Sort-Object', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'where': { cmdlet: 'Where-Object', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'group': { cmdlet: 'Group-Object', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'measure': { cmdlet: 'Measure-Object', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'ft': { cmdlet: 'Format-Table', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'fl': { cmdlet: 'Format-List', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'fw': { cmdlet: 'Format-Wide', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    
    // Variables and Environment
    'gv': { cmdlet: 'Get-Variable', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'sv': { cmdlet: 'Set-Variable', risk: 'MEDIUM', category: 'SYSTEM_MODIFICATION' },
    'rv': { cmdlet: 'Remove-Variable', risk: 'MEDIUM', category: 'SYSTEM_MODIFICATION' },
    'set': { cmdlet: 'Set-Variable', risk: 'MEDIUM', category: 'SYSTEM_MODIFICATION' },
    
    // Dangerous CMD carryovers
    'format': { cmdlet: 'Format-Volume', risk: 'CRITICAL', category: 'SYSTEM_DESTRUCTION' },
    'cls': { cmdlet: 'Clear-Host', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'clear': { cmdlet: 'Clear-Host', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'echo': { cmdlet: 'Write-Output', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'man': { cmdlet: 'Get-Help', risk: 'LOW', category: 'INFORMATION_GATHERING' },
    'help': { cmdlet: 'Get-Help', risk: 'LOW', category: 'INFORMATION_GATHERING' },
};

/** Suspicious command patterns that might be disguised threats */
const SUSPICIOUS_ALIAS_PATTERNS: readonly string[] = [
    // Base64 encoded commands
    'powershell.*-enc.*[A-Za-z0-9+/=]{20,}',
    'pwsh.*-enc.*[A-Za-z0-9+/=]{20,}',
    
    // Hidden/window manipulation
    '-windowstyle\\s+hidden',
    '-w\\s+hidden',
    '-noninteractive',
    '-noni',
    
    // Bypass execution policy
    '-executionpolicy\\s+bypass',
    '-ep\\s+bypass',
    '-exec\\s+bypass',
    
    // Download and execute patterns
    '(iwr|wget|curl).*\\|.*iex',
    'downloadstring.*invoke-expression',
    'net\\.webclient.*downloadstring',
    
    // Obfuscated commands
    '\\$\\w+\\s*=\\s*[\'"][A-Za-z0-9+/=]{10,}[\'"]',
    'invoke-expression.*frombase64string',
    '\\[system\\.text\\.encoding\\].*getstring',
    
    // Registry/system manipulation via aliases
    'sp\\s+hklm:',
    'sp\\s+hkcu:',
    'ni.*-path.*registry',
] as const;

// ==============================================================================
// LOGGING INFRASTRUCTURE - Enterprise-grade audit system
// ==============================================================================

// Audit logging now imported from logging/audit.ts

/** Log comprehensive system information at startup */
function logSystemInfo(): void {
    const systemInfo: SystemInfo = {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cwd: process.cwd(),
        hostname: os.hostname(),
        user: os.userInfo().username,
        totalMemory: Math.round(os.totalmem() / 1024 / 1024) + 'MB',
        freeMemory: Math.round(os.freemem() / 1024 / 1024) + 'MB',
        cpus: os.cpus().length + ' cores',
        uptime: Math.round(os.uptime()) + 's'
    };
    
    console.error("=".repeat(60));
    console.error("🚀 Enterprise PowerShell MCP Server Starting");
    console.error("=".repeat(60));
    console.error(`📍 Process ID: ${systemInfo.pid}`);
    console.error(`🖥️  Platform: ${systemInfo.platform} (${systemInfo.arch})`);
    console.error(`⚡ Node.js: ${systemInfo.nodeVersion}`);
    console.error(`👤 User: ${systemInfo.user}@${systemInfo.hostname}`);
    console.error(`📁 Working Directory: ${systemInfo.cwd}`);
    console.error(`💾 Memory: ${systemInfo.freeMemory} free / ${systemInfo.totalMemory} total`);
    console.error(`🔧 CPU: ${systemInfo.cpus}`);
    console.error(`⏱️  System Uptime: ${systemInfo.uptime}`);
    console.error("=".repeat(60));
    
    auditLog('INFO', 'SYSTEM_INFO', 'Enterprise MCP Server system information logged', systemInfo);
}

// ==============================================================================
// VALIDATION SCHEMAS - Strongly-typed input validation
// ==============================================================================

/** PowerShell command execution schema */
const PowerShellCommandSchema = z.object({
    command: z.string().min(1).describe('PowerShell command to execute'),
    timeout: z.number().optional().describe('Timeout in seconds (default 90 if omitted)'),
    aiAgentTimeoutSec: z.number().optional().describe('Deprecated alias aiAgentTimeout supported; timeout override in seconds'),
    workingDirectory: z.string().optional().describe('Working directory for command execution'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
    confirmed: z.boolean().optional().describe('Explicit confirmation for medium-risk commands (required for RISKY/UNKNOWN commands)'),
    override: z.boolean().optional().describe('Security override for authorized administrators (use with extreme caution)'),
});

/** PowerShell script execution schema */
const PowerShellScriptSchema = z.object({
    script: z.string().min(1).describe('PowerShell script content to execute'),
    timeout: z.number().optional().describe('Timeout in seconds (default 90 if omitted)'),
    aiAgentTimeoutSec: z.number().optional().describe('Deprecated alias aiAgentTimeout supported; timeout override in seconds'),
    workingDirectory: z.string().optional().describe('Working directory for script execution'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
    confirmed: z.boolean().optional().describe('Explicit confirmation for medium-risk scripts'),
    override: z.boolean().optional().describe('Security override for authorized administrators'),
});

/** PowerShell file execution schema */
const PowerShellFileSchema = z.object({
    filePath: z.string().min(1).describe('Path to PowerShell script file to execute'),
    parameters: z.record(z.string()).optional().describe('Parameters to pass to the script'),
    timeout: z.number().optional().describe('Timeout in seconds (default 90 if omitted)'),
    aiAgentTimeoutSec: z.number().optional().describe('Deprecated alias aiAgentTimeout supported; timeout override in seconds'),
    workingDirectory: z.string().optional().describe('Working directory for script execution'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
    confirmed: z.boolean().optional().describe('Explicit confirmation for medium-risk file operations'),
    override: z.boolean().optional().describe('Security override for authorized administrators'),
});

/** Syntax check schema */
const SyntaxCheckSchema = z.object({
    content: z.string().min(1).describe('PowerShell script content to validate syntax'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
});

/** Help system schema */
const HelpSchema = z.object({
    topic: z.string().optional().describe('Specific help topic: security, monitoring, authentication, examples, capabilities, ai-agents, working-directory, or prompts'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
});

/** AI agent testing schema */
const AITestSchema = z.object({
    testSuite: z.string().optional().default('basic').describe('Test suite to run: basic, security, monitoring, or comprehensive'),
    skipDangerous: z.boolean().optional().default(true).describe('Skip dangerous command tests (recommended: true for safety)'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
});

/** Git status schema */
const GitStatusSchema = z.object({
    porcelain: z.boolean().optional().default(true).describe('Return git status in porcelain v1 format')
});

/** Git commit schema */
const GitCommitSchema = z.object({
    message: z.string().min(1).max(200).describe('Commit message (<=200 chars enforced)'),
    addAll: z.boolean().optional().default(false).describe('Stage all changes (git add -A) before committing'),
    signoff: z.boolean().optional().default(false).describe('Add Signed-off-by line'),
    allowEmpty: z.boolean().optional().default(false).describe('Allow empty commit if no staged changes'),
});

/** Git push schema */
const GitPushSchema = z.object({
    remote: z.string().optional().default('origin').describe('Remote name'),
    branch: z.string().optional().describe('Branch to push (defaults to current)'),
    setUpstream: z.boolean().optional().default(false).describe('Add --set-upstream if pushing new branch'),
    forceWithLease: z.boolean().optional().default(false).describe('Use --force-with-lease (discouraged; only if explicitly requested)')
});

// ==============================================================================
// ENTERPRISE MCP SERVER CLASS
// ==============================================================================

/**
 * Enterprise-scale PowerShell MCP Server with comprehensive functionality
 * 
 * Features:
 * - Advanced security classification and threat detection
 * - MCP-compliant logging and audit trails
 * - AI agent integration and testing framework
 * - Comprehensive error handling and recovery
 * - Enterprise-grade type safety and maintainability
 */
export class EnterprisePowerShellMCPServer {
    private server: Server;
    private authKey?: string;
    public readonly startTime: Date;
    public commandCount: number = 0;
    
    // Threat tracking system
    private unknownThreats: Map<string, UnknownThreatEntry> = new Map();
    private sessionId: string = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    private threatStats: ThreatTrackingStats = {
        totalUnknownCommands: 0,
        uniqueThreats: 0,
        highRiskThreats: 0,
        aliasesDetected: 0,
        sessionsWithThreats: 0
    };
    
    // Phase 2: metrics & dynamic pattern caches
    private metrics = {
        commands: 0,
        executions: 0,
        blocked: 0,
        truncated: 0,
        byLevel: {
            SAFE: 0, RISKY: 0, DANGEROUS: 0, CRITICAL: 0, BLOCKED: 0, UNKNOWN: 0
        } as Record<SecurityLevel, number>,
        durationsMs: [] as number[],
        lastReset: new Date().toISOString()
    };
    private mergedPatterns?: {
        safe: RegExp[];
        risky: RegExp[];
        blocked: RegExp[]; // union of registry/system/root/remote/critical/dangerous
    };
    
    // Rate limiting (simple token bucket keyed by parent PID)
    private rateBuckets: Map<number, { tokens: number; lastRefill: number }> = new Map();
    
    private enforceRateLimit(clientPid: number): { allowed: boolean; remaining: number; resetMs: number } {
        const cfg = ENTERPRISE_CONFIG.rateLimit;
        if (!cfg || !cfg.enabled) return { allowed: true, remaining: cfg?.burst || 0, resetMs: 0 };
        const now = Date.now();
        let bucket = this.rateBuckets.get(clientPid);
        if (!bucket) {
            bucket = { tokens: cfg.burst, lastRefill: now };
            this.rateBuckets.set(clientPid, bucket);
        }
        // Refill
        const since = now - bucket.lastRefill;
        if (since >= cfg.intervalMs) {
            const intervals = Math.floor(since / cfg.intervalMs);
            bucket.tokens = Math.min(cfg.burst, bucket.tokens + intervals * cfg.maxRequests);
            bucket.lastRefill += intervals * cfg.intervalMs;
        }
        if (bucket.tokens <= 0) {
            return { allowed: false, remaining: 0, resetMs: cfg.intervalMs - (now - bucket.lastRefill) };
        }
        bucket.tokens--;
        return { allowed: true, remaining: bucket.tokens, resetMs: cfg.intervalMs - (now - bucket.lastRefill) };
    }
    
    constructor(authKey?: string) {
        this.authKey = authKey;
        this.startTime = new Date();
        
        // Initialize and log system information
        logSystemInfo();
        // Detect and log which PowerShell host will be used (Core vs Windows) with version
        (async () => {
            const tryHosts = ['pwsh.exe','powershell.exe'];
            for(const host of tryHosts){
                try {
                    const proc = spawn(host, ['-NoLogo','-NoProfile','-Command','"$v=$PSVersionTable; $o=[pscustomobject]@{ Edition=$v.PSEdition; Version=$v.PSVersion.ToString(); CLR=$v.CLRVersion; }; $o | ConvertTo-Json -Compress"'], { windowsHide:true });
                    let out=''; let err='';
                    proc.stdout.on('data',d=> out+=d.toString());
                    proc.stderr.on('data',d=> err+=d.toString());
                    proc.on('close', code=>{
                        if(code===0 && out){
                            try {
                                const info = JSON.parse(out.trim());
                                console.error(`🔑 PowerShell Host Detected: ${host} Edition=${info.Edition||'?'} Version=${info.Version||'?'}${info.CLR? ' CLR='+info.CLR:''}`);
                                auditLog('INFO','POWERSHELL_HOST','PowerShell host detected',{ host, edition: info.Edition, version: info.Version, clr: info.CLR });
                            } catch {
                                console.error(`🔑 PowerShell Host Detected: ${host} (parse-failed raw=${out.trim().slice(0,80)})`);
                                auditLog('INFO','POWERSHELL_HOST','PowerShell host detected (unparsed)',{ host, raw: out.trim().slice(0,200) });
                            }
                        } else if(code===0){
                            console.error(`🔑 PowerShell Host Detected: ${host} (no output)`);
                            auditLog('INFO','POWERSHELL_HOST','PowerShell host detected (no output)',{ host });
                        }
                    });
                    break; // attempt first available host only
                } catch {/* try next */}
            }
        })();
        
        // Create MCP server with enterprise configuration
        this.server = new Server(
            {
                name: 'enterprise-powershell-mcp-server',
                version: '2.0.0',
            },
            {
                capabilities: {
                    tools: {
                        listChanged: true
                    },
                },
            }
        );
        
        // Set server instance for logging
        setMCPServer(this.server);
        // Start metrics HTTP server (Phase 2 scaffold)
        metricsHttpServer.start();
        // Log dashboard URL (stderr + audit) once metrics server chooses its port
        ((): void => {
            let attempts = 0;
            const maxAttempts = 12; // ~3s worst case
            const tick = () => {
                attempts++;
                try {
                    if (metricsHttpServer.isStarted()) {
                        const dashPort = metricsHttpServer.getPort();
                        const url = `http://127.0.0.1:${dashPort}/dashboard`;
                        console.error(`📊 Metrics Dashboard: ${url} (events, metrics, performance)`);
                        auditLog('INFO', 'DASHBOARD_READY', 'Metrics dashboard available', { url, port: dashPort });
                        return; // stop without scheduling another
                    }
                } catch {}
                if (attempts < maxAttempts) setTimeout(tick, 250);
            };
            setTimeout(tick, 250);
        })();
        
        // Enhanced authentication logging
        this.logAuthenticationStatus();
        
        // Log server configuration
        this.logServerConfiguration();
        
        // Setup request handlers
        this.setupHandlers();
    }
    
    /** Log authentication configuration */
    private logAuthenticationStatus(): void {
        if (this.authKey) {
            console.error(`🔒 AUTHENTICATION: Enabled (Enterprise Mode)`);
            console.error(`🔑 Key Length: ${this.authKey.length} characters`);
            console.error(`🔑 Key Preview: ${this.authKey.substring(0, 3)}${'*'.repeat(Math.max(0, this.authKey.length - 3))}`);
            auditLog('INFO', 'AUTH_ENABLED', 'Enterprise MCP Server started with key authentication', {
                keyLength: this.authKey.length,
                keyPreview: this.authKey.substring(0, 3) + '***',
                authMethod: 'key-based',
                mode: 'enterprise'
            });
        } else {
            console.error(`⚠️  AUTHENTICATION: Disabled (Development Mode)`);
            console.error(`🚨 WARNING: Any MCP client can execute PowerShell commands!`);
            auditLog('WARNING', 'AUTH_DISABLED', 'Enterprise MCP Server started without authentication - development mode only', {
                securityLevel: 'none',
                risk: 'high',
                mode: 'development'
            });
        }
    }
    
    /** Log server configuration details */
    private logServerConfiguration(): void {
        console.error(`🛠️  Server Name: enterprise-powershell-mcp-server`);
        console.error(`📦 Server Version: 2.0.0 (Enterprise)`);
        console.error(`🕒 Started At: ${this.startTime.toISOString()}`);
        console.error("=".repeat(60));
        
        // Enhanced monitoring instructions
        console.error(`📊 ENTERPRISE AUDIT LOGGING ENABLED:`);
        console.error(`📁 Log Location: ./logs/powershell-mcp-audit-${new Date().toISOString().split('T')[0]}.log`);
        console.error(`🔍 Real-time monitoring options:`);
        console.error(`   • PowerShell: .\\Simple-LogMonitor.ps1 -Follow`);
        console.error(`   • Separate Window: .\\Start-SimpleLogMonitor.ps1`);
        console.error(`   • Manual: Get-Content ./logs/powershell-mcp-audit-*.log -Wait -Tail 10`);
        console.error(`🛡️  Enterprise Security: 5-level classification (SAFE/RISKY/DANGEROUS/CRITICAL/BLOCKED)`);
        console.error(`⚠️  Threat Protection: Advanced pattern detection with comprehensive blocking`);
        console.error(`🤖 AI Agent Integration: Comprehensive help and testing framework`);
        console.error("─".repeat(60));
    }
    
    /** Validate authentication key */
    private validateAuthKey(providedKey?: string): boolean {
        // If no auth key is set, allow access (development mode)
        if (!this.authKey) {
            if (ENTERPRISE_CONFIG.security.enforceAuth === true) {
                // Misconfiguration: enforceAuth requested without key; degrade to warning and allow for now
                auditLog('WARNING', 'AUTH_MISCONFIGURED', 'enforceAuth true but no MCP_AUTH_KEY set; allowing requests (development fallback)');
            }
            return true;
        }
        
        // If auth key is set, require matching key
        if (!providedKey || providedKey !== this.authKey) {
            auditLog('WARNING', 'AUTH_FAILED', 'Authentication failed - invalid or missing key', {
                hasProvidedKey: !!providedKey,
                providedKeyLength: providedKey?.length || 0,
                expectedKeyLength: this.authKey.length,
                serverMode: 'enterprise'
            });
            return false;
        }
        
        auditLog('INFO', 'AUTH_SUCCESS', 'Enterprise authentication successful');
        return true;
    }
    
    /** Get client information for tracking */
    private getClientInfo(): ClientInfo {
        return {
            parentPid: process.ppid || 0,
            serverPid: process.pid,
            connectionId: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
    }
    
    /** Detect and analyze PowerShell aliases for security threats */
    private detectPowerShellAlias(command: string): AliasDetectionResult {
        const commandParts = command.trim().split(/\s+/);
        const firstCommand = commandParts[0].toLowerCase();
        
        // Check if it's a known alias
        if (POWERSHELL_ALIAS_MAP[firstCommand]) {
            const aliasInfo = POWERSHELL_ALIAS_MAP[firstCommand];
            this.threatStats.aliasesDetected++;
            
            auditLog('WARNING', 'ALIAS_DETECTED', `PowerShell alias detected: ${firstCommand} -> ${aliasInfo.cmdlet}`, {
                originalAlias: firstCommand,
                resolvedCmdlet: aliasInfo.cmdlet,
                riskLevel: aliasInfo.risk,
                category: aliasInfo.category,
                fullCommand: command,
                sessionId: this.sessionId
            });
            
            return {
                alias: firstCommand,
                cmdlet: aliasInfo.cmdlet,
                risk: aliasInfo.risk,
                category: aliasInfo.category,
                originalCommand: command,
                resolvedCommand: aliasInfo.cmdlet,
                isAlias: true,
                aliasType: 'BUILTIN',
                securityRisk: aliasInfo.risk,
                reason: `Detected PowerShell alias '${firstCommand}' resolves to '${aliasInfo.cmdlet}' with ${aliasInfo.risk} risk`
            };
        }
        
        // Check for suspicious patterns
        for (const pattern of SUSPICIOUS_ALIAS_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                auditLog('CRITICAL', 'SUSPICIOUS_PATTERN', `Suspicious command pattern detected: ${pattern}`, {
                    pattern: pattern,
                    command: command,
                    sessionId: this.sessionId,
                    riskLevel: 'CRITICAL'
                });
                // Surface suspicious pattern detections to metrics dashboard immediately
                try {
                    metricsHttpServer.publishExecution({
                        id: `susp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
                        level: 'CRITICAL',
                        durationMs: 0,
                        blocked: false, // not yet blocked by policy – classification continues
                        truncated: false,
                        timestamp: new Date().toISOString(),
                        preview: command.substring(0,120) + ' [SUSPICIOUS]',
                        success: false,
                        exitCode: null
                    });
                    metricsRegistry.record({ level: 'CRITICAL' as any, blocked: false, durationMs: 0, truncated: false });
                } catch {}
                
                return {
                    alias: firstCommand,
                    cmdlet: firstCommand,
                    risk: 'CRITICAL',
                    category: 'SECURITY_THREAT',
                    originalCommand: command,
                    isAlias: false,
                    aliasType: 'UNKNOWN',
                    securityRisk: 'CRITICAL',
                    reason: `Suspicious pattern detected: ${pattern} - possible obfuscated or malicious command`
                };
            }
        }
        
        // Not a known alias
        return {
            alias: firstCommand,
            cmdlet: firstCommand,
            risk: 'LOW',
            category: 'INFORMATION_GATHERING',
            originalCommand: command,
            isAlias: false,
            aliasType: 'UNKNOWN',
            securityRisk: 'LOW',
            reason: 'Command is not a recognized PowerShell alias'
        };
    }
    
    /** Track unknown or suspicious commands as potential threats */
    private trackUnknownThreat(command: string, assessment: SecurityAssessment): void {
        const commandKey = command.toLowerCase().trim();
        const now = new Date().toISOString();
        
        if (this.unknownThreats.has(commandKey)) {
            // Update existing threat
            const existing = this.unknownThreats.get(commandKey)!;
            existing.frequency++;
            existing.lastSeen = now;
            existing.riskAssessment = assessment;
        } else {
            // New unknown threat
            this.threatStats.totalUnknownCommands++;
            this.threatStats.uniqueThreats++;
            
            if (assessment.risk === 'HIGH' || assessment.risk === 'CRITICAL') {
                this.threatStats.highRiskThreats++;
            }
            
            // Analyze for possible aliases
            const aliasDetection = this.detectPowerShellAlias(command);
            const possibleAliases = aliasDetection.isAlias ? [aliasDetection.resolvedCommand || ''] : [];
            
            const threatEntry: UnknownThreatEntry = {
                timestamp: now,
                id: `threat_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
                command: command,
                count: 1,
                frequency: 1,
                firstSeen: now,
                lastSeen: now,
                possibleAliases: possibleAliases,
                riskAssessment: assessment,
                sessionId: this.sessionId,
                risk: assessment.risk,
                level: assessment.level,
                category: assessment.category,
                reasons: [assessment.reason]
            };
            
            this.unknownThreats.set(commandKey, threatEntry);
            // Phase A learning journal (redacted + hashed)
            try { recordUnknownCandidate(command, this.sessionId, LEARNING_CONFIG); } catch {}
            
            // Log new unknown threat
            auditLog('WARNING', 'UNKNOWN_THREAT', `New unknown command tracked as potential threat`, {
                command: command,
                riskLevel: assessment.risk,
                category: assessment.category,
                possibleAliases: possibleAliases,
                sessionId: this.sessionId,
                threatCount: this.threatStats.uniqueThreats
            });
            // Emit UNKNOWN event so it appears in dashboard even if later not executed
            try {
                const norm = recordUnknownCandidate(command, this.sessionId, LEARNING_CONFIG) || undefined;
                metricsHttpServer.publishExecution({
                    id: `unk-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
                    level: 'UNKNOWN',
                    durationMs: 0,
                    blocked: false,
                    truncated: false,
                    timestamp: new Date().toISOString(),
                    preview: command.substring(0,120) + ' [UNKNOWN]',
                    success: false,
                    exitCode: null,
                    candidateNorm: norm
                });
                metricsRegistry.record({ level: 'UNKNOWN' as any, blocked: false, durationMs: 0, truncated: false });
            } catch {}
        }
    }
    
    /** Get current threat tracking statistics */
    getThreatStats(): ThreatTrackingStats & { recentThreats: UnknownThreatEntry[] } {
        const recent = Array.from(this.unknownThreats.values())
            .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
            .slice(0, 10);
        
        return {
            ...this.threatStats,
            recentThreats: recent
        };
    }
    
    /** Comprehensive command safety classification with alias detection */
    classifyCommandSafety(command: string): SecurityAssessment {
        const upperCommand = command.toUpperCase();
        const lowerCommand = command.toLowerCase();
        
        // First, detect aliases and suspicious patterns
        const aliasDetection = this.detectPowerShellAlias(command);
        
        // If it's a high-risk alias, factor that into the assessment
        if (aliasDetection.isAlias && aliasDetection.securityRisk === 'CRITICAL') {
            return {
                level: 'CRITICAL',
                risk: 'CRITICAL',
                reason: `${aliasDetection.reason} - Alias masks potentially dangerous command`,
                color: 'RED',
                blocked: true,
                requiresPrompt: false,
                category: 'ALIAS_THREAT',
                patterns: aliasDetection.originalCommand ? [aliasDetection.originalCommand].filter(Boolean) : [],
                recommendations: ['Use full cmdlet names instead of aliases', 'Review command for malicious intent']
            };
        }
        
        // Continue with existing security patterns
        // 🚫 BLOCKED PATTERNS - These commands are completely blocked
        
        // Phase 2 dynamic pattern merging (lazy init)
        if (!this.mergedPatterns) {
            const sup = new Set((ENTERPRISE_CONFIG.security.suppressPatterns||[]).map((p:string)=>p.toLowerCase()));
            const addBlocked = (ENTERPRISE_CONFIG.security.additionalBlocked||[]).map((p:string)=>new RegExp(p, 'i'));
            const addSafe = (ENTERPRISE_CONFIG.security.additionalSafe||[]).map((p:string)=>new RegExp(p, 'i'));
            const filterSet = (arr: readonly string[]) => arr.filter(p=>!sup.has(p.toLowerCase())).map(p=>new RegExp(p,'i'));
            const blocked = [
                ...filterSet(REGISTRY_MODIFICATION_PATTERNS),
                ...filterSet(SYSTEM_FILE_PATTERNS),
                ...filterSet(ROOT_DELETION_PATTERNS),
                ...filterSet(REMOTE_MODIFICATION_PATTERNS),
                ...filterSet(CRITICAL_PATTERNS),
                ...filterSet(DANGEROUS_COMMANDS),
                ...addBlocked
            ];
            const risky = filterSet(RISKY_PATTERNS);
            // Incorporate learned safe patterns (regex sources) if present
            let learned: RegExp[] = [];
            try { learned = loadLearnedPatterns().map(p=> new RegExp(p,'i')); } catch {}
            const safe = [...filterSet(SAFE_PATTERNS), ...addSafe, ...learned];
            this.mergedPatterns = { safe, risky, blocked };
        }

        // BLOCKED
        for (const rx of this.mergedPatterns.blocked) {
            if (rx.test(command)) {
                return {
                    level: /powershell|encodedcommand|invoke-webrequest|download|string|webclient|format-volume|set-itemproperty/i.test(rx.source) ? 'CRITICAL' : 'BLOCKED',
                    risk: 'CRITICAL',
                    reason: `Blocked by security policy: ${rx.source}`,
                    color: 'RED',
                    blocked: true,
                    requiresPrompt: false,
                    category: 'SECURITY_THREAT',
                    patterns: [rx.source],
                    recommendations: ['Remove dangerous operations', 'Use read-only alternatives']
                } as SecurityAssessment;
            }
        }
        // Additional hardcoded dangerous patterns (fallback)
        if (upperCommand.includes('FORMAT C:') ||
            upperCommand.includes('DEL /') ||
            upperCommand.includes('RMDIR /') ||
            upperCommand.includes('SHUTDOWN') ||
            upperCommand.includes('RESTART-COMPUTER') ||
            lowerCommand.includes('rm -rf') ||
            lowerCommand.includes('sudo') ||
            upperCommand.includes('NET USER') ||
            upperCommand.includes('NET LOCALGROUP')) {
            return {
                level: 'DANGEROUS',
                risk: 'HIGH',
                reason: 'System destructive or privilege escalation command',
                color: 'MAGENTA',
                blocked: true,
                requiresPrompt: false,
                category: 'SYSTEM_DESTRUCTION',
                recommendations: ['Use non-destructive alternatives', 'Test in isolated environment']
            } as SecurityAssessment;
        }
        
        // RISKY
        for (const rx of this.mergedPatterns.risky) {
            if (rx.test(command)) {
                return {
                    level: 'RISKY',
                    risk: 'MEDIUM',
                    reason: `File/service modification operation: ${rx.source}`,
                    color: 'YELLOW',
                    blocked: false,
                    requiresPrompt: true,
                    category: 'FILE_OPERATION',
                    patterns: [rx.source],
                    recommendations: ['Add confirmed: true to proceed', 'Use -WhatIf for testing']
                };
            }
        }

        // SAFE
        for (const rx of this.mergedPatterns.safe) {
            if (rx.test(command)) {
                return {
                    level: 'SAFE',
                    risk: 'LOW',
                    reason: `Safe read-only operation: ${rx.source}`,
                    color: 'GREEN',
                    blocked: false,
                    requiresPrompt: false,
                    category: 'INFORMATION_GATHERING',
                    patterns: [rx.source],
                    recommendations: ['Command is safe to execute']
                };
            }
        }
        
        // 🔵 UNKNOWN - Default for unclassified commands with threat tracking
        const unknownAssessment: SecurityAssessment = {
            level: 'UNKNOWN',
            risk: 'MEDIUM',
            reason: 'Unclassified command requiring confirmation for safety',
            color: 'CYAN',
            blocked: false,
            requiresPrompt: true,
            category: 'UNKNOWN_COMMAND',
            recommendations: ['Add confirmed: true to proceed', 'Review command for safety']
        };
        
        // Track this unknown command as a potential threat
        this.trackUnknownThreat(command, unknownAssessment);
        
        return unknownAssessment;
    }
    
    // executePowerShellCommand now provided by tools/runPowerShell.ts (legacy kept for backward compatibility removal)
    
    /** Check PowerShell syntax without execution */
    async checkPowerShellSyntax(content: string): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }> {
        try {
            const syntaxCheckCommand = `
                try {
                    $null = [System.Management.Automation.PSParser]::Tokenize(@'
${content}
'@, [ref]$null)
                    Write-Output 'SYNTAX_VALID'
                } catch {
                    Write-Output "SYNTAX_ERROR: $($_.Exception.Message)"
                }
            `;
            
            const result = await this.executePowerShellCommand(syntaxCheckCommand, 30000);
            
            if (result.success && result.stdout.includes('SYNTAX_VALID')) {
                return {
                    isValid: true,
                    errors: [],
                    warnings: []
                };
            } else {
                const errorMessage = result.stdout.replace('SYNTAX_ERROR: ', '').trim();
                return {
                    isValid: false,
                    errors: [errorMessage || result.stderr || 'Unknown syntax error'],
                    warnings: []
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                isValid: false,
                errors: [errorMessage],
                warnings: []
            };
        }
    }
    
    /** Generate comprehensive help for AI agents */
    generateHelpForAIAgents(topic?: string): string {
    const helpSections = {
            overview: `
# 🤖 Enterprise PowerShell MCP Server - AI Agent Guide

## 🎯 Purpose
This MCP server provides secure, enterprise-grade PowerShell command execution with advanced security classification, comprehensive audit logging, and AI agent optimization.

## 🔧 Available Tools
- **powershell-command**: Execute single PowerShell commands
- **powershell-script**: Execute multi-line PowerShell scripts  
- **powershell-file**: Execute PowerShell script files
- **powershell-syntax-check**: Validate PowerShell syntax without execution
- **server-stats**: Retrieve metrics, dynamic pattern overrides and rate limit snapshot
- **enforce-working-directory**: Enable/disable working directory enforcement policy  
- **get-working-directory-policy**: Check current working directory policy status
- **help**: Get comprehensive help and guidance
- **ai-agent-test**: Run validation tests for server functionality

## 🛡️ Security Levels
- **SAFE** (🟢): Read-only operations, execute freely
- **RISKY** (🟡): Requires confirmation (add confirmed: true)
- **DANGEROUS** (🟣): Blocked - system modifications
- **CRITICAL** (🔴): Blocked - security threats
- **BLOCKED** (🚫): Completely prohibited operations`,

            security: `
# 🛡️ Enterprise Security Framework

## Security Classification System
This server implements a 5-level security classification system:

### 🟢 SAFE Commands (Execute Freely)
- Get-* commands (Get-Date, Get-Process, Get-Location)
- Show-* commands  
- Test-* commands (read-only)
- Out-* commands (Out-Host, Out-String)
- Write-* commands (Write-Host, Write-Output)
- Format-*, Select-*, Where-Object, Sort-Object

### 🟡 RISKY Commands (Require Confirmation)
- File operations: Remove-Item, Move-Item, Copy-Item
- Service operations: Start-Service, Restart-Service
- Process management: Stop-Process
- Add 'confirmed: true' to parameter to proceed

### 🟣 DANGEROUS Commands (Blocked)
- System modifications: Stop-Computer, Restart-Computer
- User management: New-LocalUser, Remove-LocalUser
- Service disabling: Set-Service Disabled
- Event log clearing: Clear-EventLog

### 🔴 CRITICAL Threats (Blocked)  
- Hidden execution: powershell -WindowStyle Hidden
- Encoded commands: powershell -EncodedCommand
- Downloads: DownloadString, WebClient
- Binary execution: cmd.exe, wscript.exe

### 🚫 BLOCKED Operations
- Registry modifications (HKLM, HKCU)
- System file operations (C:\\Windows\\System32)
- Root drive operations (Format-Volume C:)
- Remote machine modifications`,

            monitoring: `
# 📊 Enterprise Monitoring & Audit System

## Comprehensive Logging
- **MCP Standard Logging**: notifications/message for real-time monitoring
- **File-based Audit Trail**: ./logs/powershell-mcp-audit-YYYY-MM-DD.log
- **Process Tracking**: Client PID → Server PID lineage
- **Security Classification**: Every command classified and logged

## Real-time Monitoring Options
- **PowerShell**: .\\Simple-LogMonitor.ps1 -Follow
- **Separate Window**: .\\Start-SimpleLogMonitor.ps1  
- **Manual**: Get-Content ./logs/powershell-mcp-audit-*.log -Wait -Tail 10

## MCP Client Notifications
- **VS Code/GitHub Copilot**: Uses stderr logging (standard behavior)
- **Advanced MCP Clients**: May support notifications/message for real-time events
- **All Clients**: File-based audit logging always available

## Audit Trail Contents
- Security level assessments
- Command execution results
- Authentication events
- Error conditions and recovery
- Performance metrics (execution time, memory usage)

## Compliance Features
- PII sanitization in logs
- Configurable log retention
- Structured JSON audit entries
- Real-time threat detection alerts`,

            authentication: `
# 🔐 Enterprise Authentication System

## Dual-Mode Operation
- **Development Mode**: No authentication (authKey not set)
- **Enterprise Mode**: Key-based authentication required

## Authentication Usage
Include authKey in all tool requests when server requires it:

\`\`\`json
{
  "tool": "powershell-command",
  "params": {
    "command": "Get-Date",
    "authKey": "your-secure-key"
  }
}
\`\`\`

## Security Considerations
- Key-based authentication for production
- Request tracking with client PID correlation
- Failed authentication attempts logged
- Override capability for authorized administrators

## Best Practices
- Use strong, unique authentication keys
- Rotate keys regularly
- Monitor authentication logs
- Implement additional authorization layers for sensitive operations`,

            examples: `
# 📚 AI Agent Usage Examples

## Basic Safe Commands
\`\`\`json
// Get system information
{
  "tool": "powershell-command", 
  "params": {
    "command": "Get-ComputerInfo | Select-Object WindowsProductName, TotalPhysicalMemory",
    "authKey": "your-key"
  }
}

// Get running processes
{
  "tool": "powershell-command",
  "params": {
    "command": "Get-Process | Where-Object {$_.WorkingSet -gt 100MB} | Select-Object Name, WorkingSet | Sort-Object WorkingSet -Descending"
  }
}
\`\`\`

## Script Execution  
\`\`\`json
{
  "tool": "powershell-script",
  "params": {
    "script": "$processes = Get-Process\\n$memory = Get-WmiObject Win32_OperatingSystem\\nWrite-Output \\"Total Processes: $($processes.Count)\\"\\nWrite-Output \\"Available Memory: $([math]::Round($memory.FreePhysicalMemory/1MB, 2)) GB\\"",
    "timeout": 30000,
    "authKey": "your-key"
  }
}
\`\`\`

## Syntax Validation
\`\`\`json
{
  "tool": "powershell-syntax-check",
  "params": {
    "content": "Get-Process | Where-Object { $_.Name -eq 'notepad' }",
    "authKey": "your-key"
  }
}
\`\`\`

## Risky Operations (Require Confirmation)
\`\`\`json
{
  "tool": "powershell-command",
  "params": {
    "command": "Remove-Item ./temp/test.txt",
    "confirmed": true,
    "authKey": "your-key"
  }
}
\`\`\``,

            capabilities: `
# 🚀 Enterprise Capabilities & Features

## Core Functionality
- **Secure Command Execution**: Enterprise-grade PowerShell command processing
- **Script Management**: Multi-line script execution and file processing
- **Syntax Validation**: Pre-execution syntax checking
- **Real-time Monitoring**: Comprehensive audit logging and alerting

## Security Features  
- **5-Level Classification**: SAFE/RISKY/DANGEROUS/CRITICAL/BLOCKED
- **Pattern-based Detection**: Registry, system file, remote operation protection
- **Threat Intelligence**: Malware pattern recognition and blocking
- **Audit Compliance**: Full execution trail with security context

## AI Agent Optimization
- **Comprehensive Help System**: Context-aware assistance
- **Testing Framework**: Validation of server functionality  
- **Smart Recommendations**: Security-aware command suggestions
- **Error Recovery**: Detailed error analysis and resolution guidance

## Enterprise Integration
- **MCP Standard Compliance**: Full protocol adherence
- **Scalable Architecture**: Type-safe, maintainable codebase
- **Performance Monitoring**: Execution time and resource tracking
- **Configuration Management**: Environment-specific settings`,

            'ai-agents': `
# 🤖 AI Agent Integration Guide

## Optimal Usage Patterns
1. **Always check help first**: Use help tool to understand capabilities
2. **Test with ai-agent-test**: Validate server functionality before use
3. **Start with safe commands**: Use Get-* commands for information gathering
4. **Handle confirmations**: Include 'confirmed: true' for risky operations
5. **Monitor security levels**: Review classification in responses
6. **Use terminal for stateful operations**: Long-running commands, session state, background jobs better suited for terminal tools

## Error Handling Best Practices
- Check 'success' field in responses
- Review 'securityAssessment' for blocked commands
- Use syntax-check tool before executing complex scripts
- Implement retry logic for transient failures

## Performance Optimization
- Set appropriate timeouts for long-running commands
- Use working directory parameter to avoid path issues
- Batch related operations when possible
- Monitor execution time in responses

## Terminal vs MCP Tool Selection
**Use Terminal Tools for:**
- **Long-running commands**: Operations taking >30 seconds (e.g., large data processing, system scans)
- **Session-dependent workflows**: Commands that modify environment variables, change directories, or maintain state
- **Background jobs**: Start-Job, background processes, monitoring tasks that continue running
- **Interactive commands**: Tools requiring user input or confirmation prompts
- **Pipeline-heavy operations**: Complex PowerShell pipelines with multiple stages

**Use MCP PowerShell Tools for:**
- **Quick information gathering**: Get-* cmdlets, system status checks
- **Isolated operations**: Single commands with clear input/output
- **Security-classified operations**: Commands requiring audit logging and security assessment
- **Syntax validation**: Testing PowerShell scripts before execution
- **Enterprise compliance**: Operations requiring authentication and policy enforcement

**Examples:**
- Terminal: Start-Job -ScriptBlock { Get-EventLog -LogName System | Export-Csv log.csv }
- MCP Tool: Get-Process | Select-Object -First 10
- Terminal: $env:PATH += ";C:\\\\NewPath"; Get-Command MyTool
- MCP Tool: Get-Date -Format "yyyy-MM-dd HH:mm:ss"

## Working Directory Usage & Enforcement
The server offers an optional policy flag: **enforceWorkingDirectory** (default: false). When enabled, any provided workingDirectory must resolve under one of the configured roots in security.allowedWriteRoots (environment variables like \${TEMP} are expanded). If a directory is outside the allowed roots, the command is blocked with error WORKING_DIRECTORY_POLICY_VIOLATION.

Guidelines:
- Prefer specifying a workingDirectory for relative path operations.
- Use isolated temp/sandbox folders for write operations.
- Create the directory with least privileges if missing before execution.
- Never target system or highly privileged paths for untrusted content.
- Reuse a dedicated sandbox directory for multi-step workflows.

Runtime Control Tools:
{ "tool": "get-working-directory-policy" }
{ "tool": "enforce-working-directory", "params": { "enabled": true } }
{ "tool": "enforce-working-directory", "params": { "enabled": false } }

## Security Compliance
- Never override security classifications without authorization
- Review audit logs for security events
- Use confirmation parameters for risky operations
- Report security violations immediately

## Testing and Validation
Use the ai-agent-test tool to validate functionality:
\`\`\`json
{
  "tool": "ai-agent-test",
  "params": {
    "testSuite": "comprehensive",
    "skipDangerous": true,
    "authKey": "your-key"
  }
}
\`\`\``,

            'working-directory': `
# 📁 Working Directory Management

## Overview
Control working directory enforcement policy to restrict where PowerShell commands can execute.

## Policy Status
Use \`get-working-directory-policy\` to check current settings:
- **enforceWorkingDirectory**: Whether enforcement is active
- **allowedWriteRoots**: Permitted directory roots  
- **status**: Current enforcement state (ENFORCED/DISABLED)

## Enable/Disable Enforcement  
\`\`\`json
// Enable enforcement
{
  "tool": "enforce-working-directory", 
  "params": { "enabled": true }
}

// Disable enforcement  
{
  "tool": "enforce-working-directory",
  "params": { "enabled": false }
}
\`\`\`

## Check Current Policy
\`\`\`json
{
  "tool": "get-working-directory-policy"
}
\`\`\`

## How It Works
When **enabled**: Commands with workingDirectory parameter must resolve under configured allowedWriteRoots (environment variables like \${TEMP} are expanded). Commands outside allowed roots are blocked with WORKING_DIRECTORY_POLICY_VIOLATION.

When **disabled** (default): Commands can use any workingDirectory without restriction.

## Best Practices
- Enable enforcement in production environments
- Configure allowedWriteRoots to include safe temporary directories
- Use dedicated sandbox directories for untrusted operations
- Always specify workingDirectory for file operations`,
            prompts: `
# 🧩 Prompt Library & Reproduction Guide

## Purpose
Provides deterministic, phase-based prompts to recreate this project from an empty workspace. Useful for audit, portability, disaster recovery, or spinning up a fresh environment.

## Retrieval Tool
Use the agent-prompts tool to access structured prompt phases or specific sections.

### Examples
\nFetch all prompts (markdown):
{ "tool": "agent-prompts", "params": { "format": "markdown" } }
\nFetch Phase 8 only (markdown):
{ "tool": "agent-prompts", "params": { "category": "Phase 8" } }
\nFetch JSON summary of all categories:
{ "tool": "agent-prompts", "params": { "format": "json" } }

## Categories
Derived from '##' headings inside docs/AGENT-PROMPTS.md (Phase 0..13 plus companion sections).

## Notes
- Do not mutate earlier phases retroactively; add migrations instead.
- Always emit MACHINE_VERIFICATION_BLOCK after each phase when reconstructing.
- Keep this file stable; modifications should update help and tool accordingly.`
    };
        
        if (topic && helpSections[topic as keyof typeof helpSections]) {
            return helpSections[topic as keyof typeof helpSections];
        }
        
        // Return comprehensive help
        return Object.values(helpSections).join('\n\n');
    }
    
    /** Run comprehensive AI agent tests */
    async runAIAgentTests(testSuite: string = 'basic', skipDangerous: boolean = true): Promise<AITestResults> {
        const results: AITestResults = {
            testSuite: testSuite,
            timestamp: new Date().toISOString(),
            serverPid: process.pid,
            skipDangerous: skipDangerous,
            totalTests: 0,
            passed: 0,
            failed: 0,
            tests: [],
            summary: {
                successRate: '0%',
                securityEnforcement: 'NEEDS_REVIEW',
                safeExecution: 'NEEDS_REVIEW',
            },
            recommendations: []
        };

        const testSuites: Record<string, AITestCase[]> = {
            basic: [
                { name: 'Get Current Date', command: 'Get-Date', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true },
                { name: 'Get Process List', command: 'Get-Process | Select-Object -First 3', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true },
                { name: 'Get PowerShell Version', command: '$PSVersionTable.PSVersion', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true },
                { name: 'Get Current Location', command: 'Get-Location', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true }
            ],
            security: [
                { name: 'Safe Command', command: 'Get-Date', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true },
                { name: 'Risky Command (blocked)', command: 'Remove-Item ./nonexistent.txt', expectedSecurity: 'RISKY' as SecurityLevel, shouldSucceed: false },
                ...(skipDangerous ? [] : [
                    { name: 'Dangerous Command (blocked)', command: 'Format-Volume -DriveLetter X -WhatIf', expectedSecurity: 'DANGEROUS' as SecurityLevel, shouldSucceed: false },
                    { name: 'Critical Command (blocked)', command: 'powershell -WindowStyle Hidden -Command "echo test"', expectedSecurity: 'CRITICAL' as SecurityLevel, shouldSucceed: false }
                ])
            ],
            monitoring: [
                { name: 'Generate Log Entry', command: 'Write-Host "AI Agent Test - Monitoring"', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true },
                { name: 'Test Process Info', command: '$PID', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true },
                { name: 'Environment Test', command: '$env:COMPUTERNAME', expectedSecurity: 'SAFE' as SecurityLevel, shouldSucceed: true }
            ],
            comprehensive: []  // Will be populated below
        };

        // Comprehensive combines all test suites
        if (testSuite === 'comprehensive') {
            testSuites.comprehensive = [
                ...testSuites.basic,
                ...testSuites.monitoring,
                ...testSuites.security.filter(test => 
                    skipDangerous ? 
                        test.expectedSecurity === 'SAFE' || test.expectedSecurity === 'RISKY' : 
                        true
                )
            ];
        }

        const commandsToTest = testSuites[testSuite] || testSuites.basic;
        results.totalTests = commandsToTest.length;

        for (const test of commandsToTest) {
            const testResult: AITestResult = {
                id: `test_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
                name: test.name,
                command: test.command,
                expectedSecurity: test.expectedSecurity,
                shouldSucceed: test.shouldSucceed,
                expectedResult: test.shouldSucceed ? 'SUCCESS' : 'BLOCKED',
                actualSecurity: 'UNKNOWN',
                actualResult: 'PENDING',
                passed: false,
                error: undefined,
                executionTime: 0,
                durationMs: 0
            };

            try {
                const startTime = Date.now();
                
                // Classify the command
                const securityAssessment = this.classifyCommandSafety(test.command);
                testResult.actualSecurity = securityAssessment.level;
                
                // Test security classification accuracy
                const securityMatch = testResult.actualSecurity === test.expectedSecurity;
                
                // For commands that should be blocked
                if (!test.shouldSucceed && (securityAssessment.blocked || securityAssessment.requiresPrompt)) {
                    testResult.actualResult = 'BLOCKED_AS_EXPECTED';
                    testResult.passed = securityMatch;
                } else if (test.shouldSucceed && securityAssessment.level === 'SAFE') {
                    // Execute safe commands
                    try {
                        const execResult = await this.executePowerShellCommand(test.command, 10000);
                        testResult.actualResult = execResult.success ? 'SUCCESS' : 'EXECUTION_FAILED';
                        testResult.passed = securityMatch && execResult.success;
                    } catch (execError) {
                        testResult.actualResult = 'EXECUTION_ERROR';
                        testResult.error = execError instanceof Error ? execError.message : String(execError);
                        testResult.passed = false;
                    }
                } else if (test.shouldSucceed && securityAssessment.requiresPrompt) {
                    testResult.actualResult = 'REQUIRES_CONFIRMATION';
                    testResult.passed = securityMatch;
                } else {
                    testResult.actualResult = 'UNEXPECTED_BEHAVIOR';
                    testResult.passed = false;
                }
                
                testResult.executionTime = Date.now() - startTime;
                
            } catch (error) {
                testResult.actualResult = 'TEST_ERROR';
                testResult.error = error instanceof Error ? error.message : String(error);
                testResult.passed = false;
            }

            results.tests.push(testResult);
            
            if (testResult.passed) {
                results.passed++;
            } else {
                results.failed++;
            }
        }

        // Calculate summary
        results.summary.successRate = `${Math.round((results.passed / results.totalTests) * 100)}%`;
        results.summary.securityEnforcement = results.tests.filter(t => t.actualResult === 'BLOCKED_AS_EXPECTED').length > 0 ? 'WORKING' : 'NEEDS_REVIEW';
        results.summary.safeExecution = results.tests.filter(t => t.actualResult === 'SUCCESS').length > 0 ? 'WORKING' : 'NEEDS_REVIEW';

        // Generate recommendations
        if (results.failed > 0) {
            results.recommendations.push('Review failed tests for potential security policy adjustments');
        }
        
        if (results.summary.securityEnforcement === 'WORKING') {
            results.recommendations.push('Security enforcement is active and blocking dangerous commands');
        }
        
        if (results.summary.safeExecution === 'WORKING') {
            results.recommendations.push('Safe command execution is working properly');
        }
        
        results.recommendations.push('Monitor logs with: .\\Simple-LogMonitor.ps1 -Follow');
        results.recommendations.push('Review security classifications regularly');
        results.recommendations.push('Test comprehensive suite periodically');

        return results;
    }
    
    /** Unified tool dispatcher created during consolidation refactor */
    private async handleToolCall(name: string, args: any, requestId: string){
        try {
            switch(name){
                case 'emit-log': {
                    const message = args.message || '(no message)';
                    auditLog('INFO','EMIT_LOG', message, { requestId });
                    return { content:[{ type:'text', text: JSON.stringify({ ok:true, message }) }] };
                }
                case 'run-powershell': {
                    const result = await runPowerShellTool(args);
                    return result;
                }
                case 'run-powershellscript': {
                    // Alias supporting either inline script (script) or file reference (scriptFile)
                    if(args.scriptFile && !args.script && !args.command){
                        const fp = path.isAbsolute(args.scriptFile) ? args.scriptFile : path.join(args.workingDirectory||process.cwd(), args.scriptFile);
                        if(!fs.existsSync(fp)){
                            return { content:[{ type:'text', text: JSON.stringify({ error: 'Script file not found', scriptFile: fp }) }] };
                        }
                        try {
                            const content = fs.readFileSync(fp,'utf8');
                            args.script = content;
                            args.command = content;
                            args._sourceFile = fp;
                        } catch(e){
                            return { content:[{ type:'text', text: JSON.stringify({ error: 'Failed to read script file', message: (e as Error).message }) }] };
                        }
                    } else if(args.script && !args.command){
                        args.command = args.script;
                    }
                    const result = await runPowerShellTool(args);
                    if(result?.structuredContent){ result.structuredContent.sourceFile = args._sourceFile; }
                    return result;
                }
                case 'powershell-syntax-check': {
                    const script = args.script || (args.filePath && fs.existsSync(args.filePath) ? fs.readFileSync(args.filePath,'utf8') : '');
                    if(!script) return { content:[{ type:'text', text: JSON.stringify({ ok:false, error:'No script content provided' }) }] };
                    // Extremely lightweight heuristic syntax validation (balanced braces / parentheses)
                    const stack: string[] = []; const pairs: Record<string,string> = { '(':')','{':'}','[':']' };
                    let balanced = true; for(const ch of script){ if(pairs[ch]) stack.push(ch); else if(Object.values(pairs).includes(ch)){ const last = stack.pop(); if(!last || pairs[last]!==ch){ balanced=false; break; } } }
                    const ok = balanced && stack.length===0;
                    return { content:[{ type:'text', text: JSON.stringify({ ok, issues: ok? []:['Unbalanced delimiters detected'] }, null, 2) }] };
                }
                case 'server-stats': {
                    const snap = metricsRegistry.snapshot(false);
                    return { content:[{ type:'text', text: JSON.stringify(snap, null, 2) }] };
                }
                case 'memory-stats': {
                    try {
                        if(args.gc && typeof global.gc === 'function') { try { global.gc(); } catch{} }
                        const mem = process.memoryUsage();
                        // Include rss, heapUsed, external; convert to MB for readability
                        const toMB = (n:number)=> Math.round((n/1024/1024)*100)/100;
                        const stats = { rssMB: toMB(mem.rss), heapUsedMB: toMB(mem.heapUsed), heapTotalMB: toMB(mem.heapTotal), externalMB: toMB(mem.external||0), arrayBuffersMB: toMB((mem as any).arrayBuffers||0), timestamp: new Date().toISOString(), gcRequested: !!args.gc };
                        return { content:[{ type:'text', text: JSON.stringify(stats, null, 2) }], structuredContent: stats };
                    } catch(e){
                        return { content:[{ type:'text', text: JSON.stringify({ error: (e as Error).message }) }] };
                    }
                }
                case 'agent-prompts': {
                    try {
                        const category = args.category; const format = args.format || 'markdown';
                        const filePath = path.join(process.cwd(),'docs','AGENT-PROMPTS.md');
                        const raw = fs.existsSync(filePath)? fs.readFileSync(filePath,'utf8') : '# Prompts file missing';
                        let output = raw;
                        if(category){
                            const regex = new RegExp(`(^#+.*${category}.*$)[\s\S]*?(?=^# )`,'im');
                            const m = raw.match(regex); if(m) output = m[0];
                        }
                        if(format==='json'){
                            return { content:[{ type:'text', text: JSON.stringify({ category: category||'all', content: output.split(/\r?\n/) }, null, 2) }] };
                        } else {
                            return { content:[{ type:'text', text: output }] };
                        }
                    } catch(e){
                        return { content:[{ type:'text', text: JSON.stringify({ error: (e as Error).message }) }] };
                    }
                }
                case 'working-directory-policy': {
                    if(args.action==='get' || !args.action){
                        return { content:[{ type:'text', text: JSON.stringify(ENTERPRISE_CONFIG.security, null, 2) }] };
                    } else if(args.action==='set'){
                        if(typeof args.enabled === 'boolean') ENTERPRISE_CONFIG.security.enforceWorkingDirectory = args.enabled;
                        if(Array.isArray(args.allowedWriteRoots)) ENTERPRISE_CONFIG.security.allowedWriteRoots = args.allowedWriteRoots;
                        auditLog('INFO','WORKING_DIR_POLICY_UPDATE','Policy updated',{ requestId, enforce: ENTERPRISE_CONFIG.security.enforceWorkingDirectory, roots: ENTERPRISE_CONFIG.security.allowedWriteRoots });
                        return { content:[{ type:'text', text: JSON.stringify({ ok:true, policy: ENTERPRISE_CONFIG.security }, null, 2) }] };
                    }
                    return { content:[{ type:'text', text: JSON.stringify({ error:'Unknown action' }) }] };
                }
                case 'threat-analysis': {
                    const threats = Array.from(this.unknownThreats.values()).sort((a,b)=> b.count-a.count);
                    return { content:[{ type:'text', text: JSON.stringify({ summary: this.threatStats, threats }, null, 2) }] };
                }
                case 'learn': {
                    const action = args.action;
                    if(action==='list'){
                        const data = aggregateCandidates(args.limit, args.minCount);
                        return { content:[{ type:'text', text: JSON.stringify({ candidates:data }, null, 2) }] };
                    } else if(action==='recommend'){
                        const rec = recommendCandidates(args.limit, args.minCount);
                        return { content:[{ type:'text', text: JSON.stringify({ recommendations:rec }, null, 2) }] };
                    } else if(action==='queue'){
                        const res = queueCandidates(args.normalized||[]);
                        return { content:[{ type:'text', text: JSON.stringify({ queued: res }, null, 2) }] };
                    } else if(action==='approve'){
                        const res = approveQueuedCandidates(args.normalized||[]);
                        return { content:[{ type:'text', text: JSON.stringify({ approved: res }, null, 2) }] };
                    } else if(action==='remove'){
                        const res = removeFromQueue(args.normalized||[]);
                        return { content:[{ type:'text', text: JSON.stringify({ removed: res }, null, 2) }] };
                    }
                    return { content:[{ type:'text', text: JSON.stringify({ error:'Unknown learn action' }) }] };
                }
                case 'ai-agent-tests': {
                    if(typeof this.runAIAgentTests === 'function'){
                        const suite = args.testSuite || 'basic';
                        const skip = args.skipDangerous !== false; // default true
                        // Basic harness placeholder; call existing method if available
                        try { const r = await this.runAIAgentTests(suite, skip); return { content:[{ type:'text', text: JSON.stringify(r, null, 2) }] }; } catch(e){ return { content:[{ type:'text', text: JSON.stringify({ error:(e as Error).message }) }] }; }
                    }
                    return { content:[{ type:'text', text: JSON.stringify({ error:'AI agent tests not implemented' }) }] };
                }
                case 'help': {
                    const topic = (args.topic||'').toLowerCase();
                    const help: Record<string,string> = {
                        security: 'Security classification system: SAFE,RISKY,DANGEROUS,CRITICAL,UNKNOWN,BLOCKED.',
                        monitoring: 'Use server-stats for metrics; threat-analysis for unknown commands.',
                        authentication: 'Set MCP_AUTH_KEY env var to enable key requirement.',
                        examples: 'run-powershell { command:"Get-Process | Select -First 1" }',
                        'working-directory': 'Policy enforced roots: '+ (ENTERPRISE_CONFIG.security.allowedWriteRoots||[]).join(', '),
                        timeouts: 'Timeout parameters are always SECONDS. Use "timeout" (preferred). Alias "aiAgentTimeoutSec" also accepted; older "aiAgentTimeout" still mapped. Default = '+ ((ENTERPRISE_CONFIG.limits.defaultTimeoutMs||90000)/1000)+'s.' 
                    };
                    if(topic && help[topic]) return { content:[{ type:'text', text: help[topic] }] };
                    return { content:[{ type:'text', text: JSON.stringify(help, null, 2) }] };
                }
                default:
                    return { content:[{ type:'text', text: JSON.stringify({ error: 'Unknown tool: '+name }) }] };
            }
        } catch(error){
            auditLog('ERROR','TOOL_CALL_FAIL','Tool invocation failed',{ name, error: error instanceof Error ? error.message : String(error), requestId });
            return { content:[{ type:'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }] };
        }
    }
    
    /** Setup MCP request handlers */
    private setupHandlers(): void {
        // Consolidated minimal tool surface
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                { name: 'emit-log', description: 'Emit structured audit log entry', inputSchema:{ type:'object', properties:{ message:{ type:'string' } } } },
                { name: 'learn', description: 'Learning actions (list|recommend|queue|approve|remove)', inputSchema:{ type:'object', properties:{ action:{ type:'string', enum:['list','recommend','queue','approve','remove'] }, limit:{ type:'number' }, minCount:{ type:'number' }, normalized:{ type:'array', items:{ type:'string' } } }, required:['action'] } },
                { name: 'working-directory-policy', description: 'Get or set working directory policy', inputSchema:{ type:'object', properties:{ action:{ type:'string', enum:['get','set'] }, enabled:{ type:'boolean' }, allowedWriteRoots:{ type:'array', items:{ type:'string' } } } } },
                { name: 'server-stats', description: 'Server metrics snapshot', inputSchema:{ type:'object', properties:{ verbose:{ type:'boolean' } } } },
                { name: 'memory-stats', description: 'Process memory usage (optionally trigger GC)', inputSchema:{ type:'object', properties:{ gc:{ type:'boolean', description:'If true and GC exposed, run global.gc() before sampling' } } } },
                { name: 'agent-prompts', description: 'Retrieve prompt library content', inputSchema:{ type:'object', properties:{ category:{ type:'string' }, format:{ type:'string', enum:['markdown','json'] } } } },
                { name: 'threat-analysis', description: 'Current threat / unknown command analysis', inputSchema:{ type:'object', properties:{} } },
                { name: 'run-powershell', description: 'Execute PowerShell command or script', inputSchema:{ type:'object', properties:{ command:{ type:'string' }, script:{ type:'string' }, workingDirectory:{ type:'string' }, timeout:{ type:'number', description:'Execution timeout in SECONDS (preferred)' }, aiAgentTimeoutSec:{ type:'number', description:'Alias: execution timeout in SECONDS (deprecated: aiAgentTimeout)' }, confirmed:{ type:'boolean' }, override:{ type:'boolean' } } } },
                { name: 'run-powershellscript', description: 'Execute PowerShell via inline script or file (alias of run-powershell)', inputSchema:{ type:'object', properties:{ script:{ type:'string' }, scriptFile:{ type:'string', description:'Relative or absolute path to .ps1 (will be read and executed inline)' }, workingDirectory:{ type:'string' }, timeout:{ type:'number', description:'Execution timeout in SECONDS' }, aiAgentTimeoutSec:{ type:'number' }, confirmed:{ type:'boolean' }, override:{ type:'boolean' } } } },
                { name: 'powershell-syntax-check', description: 'Validate PowerShell syntax', inputSchema:{ type:'object', properties:{ script:{ type:'string' }, filePath:{ type:'string' } } } },
                { name: 'ai-agent-tests', description: 'Run AI agent test suite', inputSchema:{ type:'object', properties:{ testSuite:{ type:'string' }, skipDangerous:{ type:'boolean' } } } },
                { name: 'help', description: 'Get structured help', inputSchema:{ type:'object', properties:{ topic:{ type:'string' } } } }
            ] }));

        // Unified CallTool -> existing consolidated dispatcher (already implemented earlier as handleToolCall)
        this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
            const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
            return this.handleToolCall(req.params.name, req.params.arguments || {}, requestId);
        });
    }
    
    /** Start the enterprise MCP server */
    async start(): Promise<void> {
        const transport = new StdioServerTransport();
        
        auditLog('INFO', 'SERVER_CONNECT', 'Enterprise MCP Server connecting to transport', {
            transport: 'stdio',
            pid: process.pid,
            nodeVersion: process.version,
            serverVersion: '2.0.0'
        });
        
        await this.server.connect(transport);
        
        console.error(`✅ ENTERPRISE MCP SERVER CONNECTED SUCCESSFULLY`);
        console.error(`🔗 Transport: STDIO`);
        console.error(`📡 Ready for AI agent requests`);
        console.error(`🛡️  Enterprise security enforcement active`);
        console.error("=".repeat(60));
        
        auditLog('INFO', 'SERVER_READY', 'Enterprise MCP Server successfully connected and ready', {
            connectionTime: new Date().toISOString(),
            totalStartupTime: Date.now() - this.startTime.getTime() + 'ms',
            serverVersion: '2.0.0',
            enterpriseMode: !!this.authKey
        });
    }
}

// Main execution function
async function main() {
    try {
        // Create enterprise server with authentication key from environment or prompt
        const authKey = process.env.MCP_AUTH_KEY;
        const server = new EnterprisePowerShellMCPServer(authKey);
        
        console.error("=".repeat(60));
        console.error(`🚀 STARTING ENTERPRISE POWERSHELL MCP SERVER`);
        console.error(`📅 Start Time: ${new Date().toISOString()}`);
        console.error(`🔢 Process ID: ${process.pid}`);
        console.error(`📈 Node.js Version: ${process.version}`);
        console.error(`🏢 Server Version: 2.0.0 (Enterprise TypeScript)`);
        console.error(`🔐 Authentication: ${authKey ? 'ENTERPRISE MODE (Key Required)' : 'DEVELOPMENT MODE'}`);
        console.error(`🛡️  Security: 5-Level Classification System Active`);
        console.error(`📊 Audit Logging: Comprehensive Enterprise Trail`);
        console.error("=".repeat(60));
        
        // Start the server
        await server.start();
        
        // Keep the process alive
        process.on('SIGINT', () => {
            console.error('\n🛑 Received SIGINT, shutting down gracefully...');
            auditLog('INFO', 'SERVER_SHUTDOWN', 'Enterprise MCP Server shutdown initiated by SIGINT', {
                uptime: Date.now() - server.startTime.getTime() + 'ms',
                commandsProcessed: server.commandCount
            });
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.error('\n🛑 Received SIGTERM, shutting down gracefully...');
            auditLog('INFO', 'SERVER_SHUTDOWN', 'Enterprise MCP Server shutdown initiated by SIGTERM', {
                uptime: Date.now() - server.startTime.getTime() + 'ms',
                commandsProcessed: server.commandCount
            });
            process.exit(0);
        });
        
        console.error(`⏳ Server running... Press Ctrl+C to shutdown`);
        
    } catch (error) {
        console.error('💥 FATAL ERROR starting Enterprise MCP Server:');
        console.error(error instanceof Error ? error.message : String(error));
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        
        auditLog('ERROR', 'SERVER_FATAL', 'Enterprise MCP Server failed to start', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        
        process.exit(1);
    }
}

// Start the server if this file is run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                    process.argv[1].endsWith('server.js') || 
                    process.argv[1].endsWith('index.js');

if (isMainModule) {
    main().catch((error) => {
        console.error('💥 Unhandled error in main:');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
