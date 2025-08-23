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
import { 
    CallToolRequestSchema, 
    ListToolsRequestSchema, 
    McpError, 
    ErrorCode,
    Tool,
    TextContent
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { spawn, ChildProcess, SpawnOptionsWithoutStdio } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { metricsRegistry } from './metrics/registry.js';
import { metricsHttpServer } from './metrics/httpServer.js';

// ============================================================================
// PHASE 1 HARDENING: Config-driven limits & path enforcement
// ============================================================================

interface EnterpriseConfig {
    security: {
        enforceAuth?: boolean; // optional
        allowedWriteRoots: string[];
        requireConfirmationForUnknown: boolean;
    enforceWorkingDirectory?: boolean; // new flag to enable/disable working directory restriction
    // Dynamic pattern override support (Phase 2)
    additionalSafe?: string[];
    additionalBlocked?: string[];
    suppressPatterns?: string[]; // patterns (raw string or regex source) to remove from built-in sets
    };
    rateLimit?: {
        enabled: boolean;
        intervalMs: number; // window for refill
        maxRequests: number; // tokens added per interval
        burst: number; // maximum bucket capacity
    };
    limits: {
        maxOutputKB: number;
        maxLines: number;
        defaultTimeoutMs: number;
    };
    logging: {
        structuredAudit: boolean;
        truncateIndicator: string;
    };
}

const DEFAULT_CONFIG: EnterpriseConfig = {
    security: {
        enforceAuth: false,
        allowedWriteRoots: ['.'],
    requireConfirmationForUnknown: true,
    enforceWorkingDirectory: false,
    additionalSafe: [],
    additionalBlocked: [],
    suppressPatterns: []
    },
    rateLimit: {
        enabled: true,
        intervalMs: 5000,
        maxRequests: 8,
        burst: 12
    },
    limits: {
        maxOutputKB: 256,
        maxLines: 2000,
        defaultTimeoutMs: 90000
    },
    logging: {
        structuredAudit: true,
        truncateIndicator: '<TRUNCATED>'
    }
};

function loadEnterpriseConfig(): EnterpriseConfig {
    const configPaths = [
        path.join(process.cwd(), 'enterprise-config.json'),
        path.join(process.cwd(), 'enterprise.config.json')
    ];
    for (const p of configPaths) {
        if (fs.existsSync(p)) {
            try {
                const raw = fs.readFileSync(p, 'utf8');
                const parsed = JSON.parse(raw);
                return {
                    security: { ...DEFAULT_CONFIG.security, ...parsed.security },
                    // Ensure rateLimit block is merged (was previously omitted, disabling rate limiting)
                    rateLimit: { ...DEFAULT_CONFIG.rateLimit, ...parsed.rateLimit },
                    limits: { ...DEFAULT_CONFIG.limits, ...parsed.limits },
                    logging: { ...DEFAULT_CONFIG.logging, ...parsed.logging }
                };
            } catch (e) {
                console.error(`⚠️  Failed to parse enterprise config ${p}: ${e instanceof Error ? e.message : e}`);
            }
        }
    }
    return DEFAULT_CONFIG;
}

const ENTERPRISE_CONFIG = loadEnterpriseConfig();

// ==============================================================================
// TYPE DEFINITIONS - Enterprise-grade type safety
// ==============================================================================

/** Security risk levels for command classification */
type SecurityLevel = 'SAFE' | 'RISKY' | 'DANGEROUS' | 'CRITICAL' | 'BLOCKED' | 'UNKNOWN';

/** Risk assessment levels */
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' | 'FORBIDDEN';

/** Security threat categories */
type ThreatCategory = 
    | 'REGISTRY_MODIFICATION' 
    | 'SYSTEM_FILE_MODIFICATION' 
    | 'ROOT_DRIVE_DELETION'
    | 'REMOTE_MODIFICATION' 
    | 'SECURITY_THREAT' 
    | 'SYSTEM_MODIFICATION'
    | 'SYSTEM_DESTRUCTION' 
    | 'PRIVILEGE_ESCALATION' 
    | 'INFORMATION_GATHERING'
    | 'FILE_OPERATION'
    | 'PROCESS_MANAGEMENT'
    | 'ALIAS_THREAT'
    | 'UNKNOWN_COMMAND';

/** Comprehensive security assessment result */
interface SecurityAssessment {
    level: SecurityLevel;
    risk: RiskLevel;
    reason: string;
    color: 'GREEN' | 'YELLOW' | 'RED' | 'MAGENTA' | 'CYAN';
    blocked: boolean;
    requiresPrompt?: boolean;
    category: ThreatCategory;
    patterns?: string[];
    recommendations?: string[];
}

/** PowerShell execution result with comprehensive metadata */
interface PowerShellExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    duration_ms: number;
    command?: string;
    workingDirectory?: string;
    securityAssessment?: SecurityAssessment;
    processId?: number;
    timedOut?: boolean;
    configuredTimeoutMs?: number;
    killEscalated?: boolean;
    error?: string;
}

/** System information structure */
interface SystemInfo {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    cwd: string;
    hostname: string;
    user: string;
    totalMemory: string;
    freeMemory: string;
    cpus: string;
    uptime: string;
}

/** Audit log entry structure */
interface AuditLogEntry {
    timestamp: string;
    level: string;
    category: string;
    message: string;
    metadata?: Record<string, any>;
    structured?: boolean;
}

/** MCP notification parameters */
interface MCPNotificationParams {
    [key: string]: unknown;
    level: string;
    logger: string;
    data: string;
}

/** Client information for tracking */
interface ClientInfo {
    parentPid: number;
    serverPid: number;
    connectionId: string;
}

/** AI agent test suite configuration */
interface AITestSuite {
    name: string;
    tests: AITestCase[];
}

/** Individual AI test case */
interface AITestCase {
    name: string;
    command: string;
    expectedSecurity: SecurityLevel;
    shouldSucceed: boolean;
}

/** AI agent test results */
interface AITestResults {
    testSuite: string;
    timestamp: string;
    serverPid: number;
    skipDangerous: boolean;
    totalTests: number;
    passed: number;
    failed: number;
    tests: AITestResult[];
    summary: {
        successRate: string;
        securityEnforcement: 'WORKING' | 'NEEDS_REVIEW';
        safeExecution: 'WORKING' | 'NEEDS_REVIEW';
    };
    recommendations: string[];
}

/** Individual AI test result */
interface AITestResult {
    name: string;
    command: string;
    expectedSecurity: SecurityLevel;
    shouldSucceed: boolean;
    actualSecurity: SecurityLevel;
    actualResult: string;
    passed: boolean;
    error: string | null;
    executionTime: number;
}

/** PowerShell alias detection result */
interface AliasDetectionResult {
    originalCommand: string;
    resolvedCommand?: string;
    isAlias: boolean;
    aliasType: 'BUILTIN' | 'CUSTOM' | 'FUNCTION' | 'CMDLET' | 'UNKNOWN';
    securityRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    reason: string;
}

/** Unknown threat tracking entry */
interface UnknownThreatEntry {
    timestamp: string;
    command: string;
    frequency: number;
    firstSeen: string;
    lastSeen: string;
    possibleAliases: string[];
    riskAssessment: SecurityAssessment;
    sessionId: string;
}

/** Threat tracking statistics */
interface ThreatTrackingStats {
    totalUnknownCommands: number;
    uniqueThreats: number;
    highRiskThreats: number;
    aliasesDetected: number;
    sessionsWithThreats: number;
}

// ==============================================================================
// SECURITY PATTERNS - Comprehensive threat detection
// ==============================================================================

/** Registry modification patterns (BLOCKED) */
const REGISTRY_MODIFICATION_PATTERNS: readonly string[] = [
    'New-ItemProperty.*HK(LM|CU)',
    'Set-ItemProperty.*HK(LM|CU)', 
    'Remove-ItemProperty.*HK(LM|CU)',
    'Remove-Item.*HK(LM|CU)',
    'reg\\s+(add|delete|import)',
    'HKEY_(LOCAL_MACHINE|CURRENT_USER)'
] as const;

/** System file modification patterns (BLOCKED) */
const SYSTEM_FILE_PATTERNS: readonly string[] = [
    'C:\\\\Windows\\\\System32',
    'C:\\\\Windows\\\\SysWOW64', 
    'C:\\\\Windows\\\\Boot',
    'C:\\\\Program Files\\\\WindowsApps'
] as const;

/** Root drive deletion patterns (BLOCKED) */
const ROOT_DELETION_PATTERNS: readonly string[] = [
    'Format-Volume.*-DriveLetter\\s+[A-Z](?!:)',
    'Remove-Item.*C:\\\\.*-Recurse',
    'rd\\s+C:\\\\.*\\/[sS]',
    'rmdir\\s+C:\\\\.*\\/[sS]'
] as const;

/** Remote modification patterns (BLOCKED) */
const REMOTE_MODIFICATION_PATTERNS: readonly string[] = [
    'Invoke-Command.*-ComputerName(?!\\s+localhost)',
    'Enter-PSSession.*(?<!localhost)',
    'New-PSSession.*(?<!localhost)',
    'Set-Service.*-ComputerName',
    'Get-WmiObject.*-ComputerName(?!\\s+localhost)'
] as const;

/** Critical security threat patterns (BLOCKED) */
const CRITICAL_PATTERNS: readonly string[] = [
    'powershell.*-EncodedCommand',
    'powershell.*-WindowStyle.*Hidden',
    'cmd\\.exe.*\\/[cC]',
    'wscript\\.exe',
    'cscript\\.exe',
    'DownloadString',
    'DownloadFile',
    'WebClient',
    'System\\.Net\\.WebClient',
    'Invoke-WebRequest.*-OutFile',
    'wget|curl.*>',
    'bitsadmin.*\\/transfer'
] as const;

/** Dangerous system operations (BLOCKED) */
const DANGEROUS_COMMANDS: readonly string[] = [
    'Stop-Computer',
    'Restart-Computer', 
    'Remove-LocalUser',
    'New-LocalUser',
    'Add-LocalGroupMember',
    'Set-ExecutionPolicy',
    'Clear-EventLog',
    'wevtutil.*clear-log',
    'Stop-Service.*Spooler|BITS|Winmgmt',
    'Set-Service.*Disabled',
    'Disable-WindowsOptionalFeature',
    'Enable-WindowsOptionalFeature'
] as const;

/** Risky operations requiring confirmation */
const RISKY_PATTERNS: readonly string[] = [
    'Remove-Item(?!.*-WhatIf)',
    'Move-Item(?!.*temp)',
    'Copy-Item.*-Force', 
    'New-Item.*-ItemType\\s+Directory',
    'Set-Content',
    'Add-Content',
    'Out-File(?!.*temp)',
    'Stop-Process(?!.*-WhatIf)',
    'Start-Service',
    'Restart-Service'
] as const;

/** Safe operations (always allowed) */
const SAFE_PATTERNS: readonly string[] = [
    '^Get-',
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

/** Logging directory and file setup */
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, `powershell-mcp-audit-${new Date().toISOString().split('T')[0]}.log`);

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** Global MCP server instance for logging */
let mcpServerInstance: Server | null = null;
let clientSupportsLogging = true; // Assume support initially, disable on first failure

/** Set the MCP server instance for proper logging */
function setMCPServer(server: Server): void {
    mcpServerInstance = server;
}

/** Sanitize metadata for logging (remove PII, limit length) */
function sanitizeMetadata(metadata: Record<string, any> | undefined): Record<string, any> | undefined {
    if (!metadata) return undefined;
    
    const sanitized: Record<string, any> = {};
    Object.keys(metadata).forEach(key => {
        const value = metadata[key];
        if (typeof value === 'string') {
            sanitized[key] = value.length > 100 ? value.substring(0, 100) + '...' : value;
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = '[Object]';
        } else {
            sanitized[key] = value;
        }
    });
    return sanitized;
}

/** Enhanced audit logging with MCP compliance */
async function auditLog(
    level: string,
    category: string,
    message: string,
    metadata?: Record<string, any>
): Promise<void> {
    const timestamp = new Date().toISOString(); // 'o' format UTC
    const logEntry: AuditLogEntry = {
        timestamp,
        level,
        category,
        message,
        ...(metadata && { metadata: sanitizeMetadata(metadata) })
    };
    
    // MCP standard logging via notifications/message (only if client supports it)
    if (mcpServerInstance && clientSupportsLogging) {
        try {
            const notificationParams: MCPNotificationParams = {
                level: level.toLowerCase(),
                logger: 'powershell-mcp-server',
                data: `[${category}] ${message}${metadata ? ` | ${JSON.stringify(sanitizeMetadata(metadata), null, 2)}` : ''}`
            };
            
            await mcpServerInstance.notification({
                method: "notifications/message",
                params: notificationParams
            });
        } catch (error) {
            // Silently disable further notification attempts on first failure
            clientSupportsLogging = false;
            console.error(`[WARN] MCP client logging notifications disabled after failure: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    // Always use stderr for logging (MCP standard for server-side logging)
    if (mcpServerInstance) {
        console.error(`[${level}] [${category}] ${timestamp} - ${message}` + 
            (metadata ? ` | ${JSON.stringify(sanitizeMetadata(metadata), null, 2)}` : ''));
    } else {
        // Server initialization phase - use INIT prefix
        console.error(`[INIT] [${level}] [${category}] ${timestamp} - ${message}` + 
            (metadata ? ` | ${JSON.stringify(sanitizeMetadata(metadata), null, 2)}` : ''));
    }
    
    // File logging (always maintained for audit trail) - Pretty JSON format
    try {
        if (ENTERPRISE_CONFIG.logging.structuredAudit) {
            const ndjsonPath = path.join(LOG_DIR, `powershell-mcp-audit-${new Date().toISOString().split('T')[0]}.ndjson`);
            fs.appendFileSync(ndjsonPath, JSON.stringify({ ...logEntry, structured: true }) + '\n');
        }
        const fileLogEntry = `[AUDIT] ${JSON.stringify(logEntry, null, 2)}\n`;
        fs.appendFileSync(LOG_FILE, fileLogEntry);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to write to log file: ${errorMsg}`);
    }
}

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
    timeout: z.number().optional().default(90000).describe('Timeout in milliseconds (default: 90 seconds)'),
    aiAgentTimeout: z.number().optional().describe('Optional AI agent-specific timeout override in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for command execution'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
    confirmed: z.boolean().optional().describe('Explicit confirmation for medium-risk commands (required for RISKY/UNKNOWN commands)'),
    override: z.boolean().optional().describe('Security override for authorized administrators (use with extreme caution)'),
});

/** PowerShell script execution schema */
const PowerShellScriptSchema = z.object({
    script: z.string().min(1).describe('PowerShell script content to execute'),
    timeout: z.number().optional().default(90000).describe('Timeout in milliseconds (default: 90 seconds)'),
    aiAgentTimeout: z.number().optional().describe('Optional AI agent-specific timeout override in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for script execution'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
    confirmed: z.boolean().optional().describe('Explicit confirmation for medium-risk scripts'),
    override: z.boolean().optional().describe('Security override for authorized administrators'),
});

/** PowerShell file execution schema */
const PowerShellFileSchema = z.object({
    filePath: z.string().min(1).describe('Path to PowerShell script file to execute'),
    parameters: z.record(z.string()).optional().describe('Parameters to pass to the script'),
    timeout: z.number().optional().default(90000).describe('Timeout in milliseconds (default: 90 seconds)'),
    aiAgentTimeout: z.number().optional().describe('Optional AI agent-specific timeout override in milliseconds'),
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
class EnterprisePowerShellMCPServer {
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
            
            if (assessment.risk === 'HIGH' || assessment.risk === 'EXTREME') {
                this.threatStats.highRiskThreats++;
            }
            
            // Analyze for possible aliases
            const aliasDetection = this.detectPowerShellAlias(command);
            const possibleAliases = aliasDetection.isAlias ? [aliasDetection.resolvedCommand || ''] : [];
            
            const threatEntry: UnknownThreatEntry = {
                timestamp: now,
                command: command,
                frequency: 1,
                firstSeen: now,
                lastSeen: now,
                possibleAliases: possibleAliases,
                riskAssessment: assessment,
                sessionId: this.sessionId
            };
            
            this.unknownThreats.set(commandKey, threatEntry);
            
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
                metricsHttpServer.publishExecution({
                    id: `unk-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
                    level: 'UNKNOWN',
                    durationMs: 0,
                    blocked: false,
                    truncated: false,
                    timestamp: new Date().toISOString(),
                    preview: command.substring(0,120) + ' [UNKNOWN]',
                    success: false,
                    exitCode: null
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
                risk: 'EXTREME',
                reason: `${aliasDetection.reason} - Alias masks potentially dangerous command`,
                color: 'RED',
                blocked: true,
                category: 'ALIAS_THREAT',
                patterns: [aliasDetection.originalCommand],
                recommendations: ['Use full cmdlet names instead of aliases', 'Review command for malicious intent']
            };
        }
        
        // Continue with existing security patterns
        // 🚫 BLOCKED PATTERNS - These commands are completely blocked
        
        // Phase 2 dynamic pattern merging (lazy init)
        if (!this.mergedPatterns) {
            const sup = new Set((ENTERPRISE_CONFIG.security.suppressPatterns||[]).map(p=>p.toLowerCase()));
            const addBlocked = (ENTERPRISE_CONFIG.security.additionalBlocked||[]).map(p=>new RegExp(p, 'i'));
            const addSafe = (ENTERPRISE_CONFIG.security.additionalSafe||[]).map(p=>new RegExp(p, 'i'));
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
            const safe = [...filterSet(SAFE_PATTERNS), ...addSafe];
            this.mergedPatterns = { safe, risky, blocked };
        }

        // BLOCKED
        for (const rx of this.mergedPatterns.blocked) {
            if (rx.test(command)) {
                return {
                    level: /powershell|encodedcommand|invoke-webrequest|download|string|webclient|format-volume|set-itemproperty/i.test(rx.source) ? 'CRITICAL' : 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Blocked by security policy: ${rx.source}`,
                    color: 'RED',
                    blocked: true,
                    category: 'SECURITY_THREAT',
                    patterns: [rx.source],
                    recommendations: ['Remove dangerous operations', 'Use read-only alternatives']
                };
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
                category: 'SYSTEM_DESTRUCTION',
                recommendations: ['Use non-destructive alternatives', 'Test in isolated environment']
            };
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
    
    /** Execute PowerShell command with comprehensive security and error handling */
    async executePowerShellCommand(
        command: string,
        timeout: number = ENTERPRISE_CONFIG.limits.defaultTimeoutMs,
        workingDirectory?: string
    ): Promise<PowerShellExecutionResult> {
        const startTime = Date.now();
        let childProcess: ChildProcess | null = null;
        let truncated = false;
        let keptBytes = 0;
        let keptLines = 0;
        
        try {
            // Working directory enforcement (guarded by flag)
            if (workingDirectory && ENTERPRISE_CONFIG.security.enforceWorkingDirectory) {
                try {
                    const real = fs.realpathSync(workingDirectory);
                    const allowed = ENTERPRISE_CONFIG.security.allowedWriteRoots.some(root => {
                        const expanded = root.replace('${TEMP}', os.tmpdir());
                        const fullRoot = path.resolve(expanded);
                        return real.startsWith(fullRoot);
                    });
                    if (!allowed) {
                        return {
                            success: false,
                            stdout: '',
                            stderr: `Working directory '${workingDirectory}' outside allowed roots`,
                            exitCode: null,
                            duration_ms: 0,
                            command,
                            workingDirectory,
                            error: 'WORKING_DIRECTORY_POLICY_VIOLATION'
                        };
                    }
                } catch (e) {
                    return {
                        success: false,
                        stdout: '',
                        stderr: `Failed to validate working directory: ${e instanceof Error ? (e as Error).message : e}`,
                        exitCode: null,
                        duration_ms: 0,
                        command,
                        workingDirectory,
                        error: 'WORKING_DIRECTORY_VALIDATION_FAILED'
                    };
                }
            }
            const options: SpawnOptionsWithoutStdio = {
                shell: false,
                ...(workingDirectory && { cwd: workingDirectory })
            };
            
            // Start PowerShell process
            childProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], options);
            
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let killEscalated = false;
            console.error(`⏱️  Scheduling timeout in ${timeout}ms for PowerShell process...`);
            
            // Set up timeout
            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                if (childProcess && !childProcess.killed) {
            console.error(`⏱️  TIMEOUT TRIGGERED after ${timeout}ms (pid=${childProcess.pid}) – sending SIGTERM`);
                    try { childProcess.kill('SIGTERM'); } catch {}
                    // Escalate after grace window
                    setTimeout(() => {
                        if (childProcess && !childProcess.killed) {
                            killEscalated = true;
                console.error(`⏱️  TIMEOUT ESCALATION (SIGKILL) pid=${childProcess.pid}`);
                            try { childProcess.kill('SIGKILL'); } catch {}
                        }
                    }, Math.min(5000, Math.max(2000, Math.floor(timeout * 0.1))));
                }
            }, timeout);
            
            // Collect output
            const MAX_BYTES = ENTERPRISE_CONFIG.limits.maxOutputKB * 1024;
            const MAX_LINES = ENTERPRISE_CONFIG.limits.maxLines;
            const truncateIndicator = ENTERPRISE_CONFIG.logging.truncateIndicator;

            if (childProcess.stdout) {
                childProcess.stdout.on('data', (data) => {
                    if (truncated) return;
                    const chunk = data.toString();
                    const lines = chunk.split(/\r?\n/);
                    for (const line of lines) {
                        if (truncated) break;
                        const prospective = stdout + (stdout ? '\n' : '') + line;
                        const prospectiveBytes = Buffer.byteLength(prospective, 'utf8');
                        const prospectiveLines = keptLines + 1;
                        if (prospectiveBytes > MAX_BYTES || prospectiveLines > MAX_LINES) {
                            truncated = true;
                            stdout += `\n${truncateIndicator}`;
                            break;
                        }
                        stdout = prospective;
                        keptBytes = prospectiveBytes;
                        keptLines = prospectiveLines;
                    }
                });
            }

            if (childProcess.stderr) {
                childProcess.stderr.on('data', (data) => {
                    if (truncated) return;
                    const chunk = data.toString();
                    const prospective = stderr + chunk;
                    const prospectiveBytes = Buffer.byteLength(stdout + prospective, 'utf8');
                    if (prospectiveBytes > MAX_BYTES) {
                        truncated = true;
                        stderr += `\n${truncateIndicator}`;
                    } else {
                        stderr = prospective;
                    }
                });
            }
            
            // Wait for completion
            const exitCode = await new Promise<number | null>((resolve) => {
                if (childProcess) {
                    childProcess.on('close', (code) => {
                        clearTimeout(timeoutHandle);
                        resolve(code);
                    });
                    
                    childProcess.on('error', (error) => {
                        clearTimeout(timeoutHandle);
                        resolve(null);
                    });
                } else {
                    resolve(null);
                }
            });
            
            const duration = Date.now() - startTime;
            const success = !timedOut && exitCode === 0;
            
            return {
                success,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
                duration_ms: duration,
                command,
                workingDirectory,
                processId: childProcess?.pid,
                timedOut,
                configuredTimeoutMs: timeout,
                ...(killEscalated ? { killEscalated: true } : {}),
                ...(timedOut ? { error: `Command timed out after ${timeout}ms${killEscalated ? ' (escalated)' : ''}` } : {}),
                ...(truncated ? { error: (timedOut ? 'TIMEOUT_AND_TRUNCATED' : 'OUTPUT_TRUNCATED') } : {})
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            return {
                success: false,
                stdout: '',
                stderr: errorMessage,
                exitCode: null,
                duration_ms: duration,
                command,
                workingDirectory,
                error: errorMessage
            };
        }
    }
    
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
                name: test.name,
                command: test.command,
                expectedSecurity: test.expectedSecurity,
                shouldSucceed: test.shouldSucceed,
                actualSecurity: 'UNKNOWN',
                actualResult: 'PENDING',
                passed: false,
                error: null,
                executionTime: 0
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
    
    /** Setup MCP request handlers */
    private setupHandlers(): void {
        // Register available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'log-test',
                        title: 'Server Log Test / Health Ping',
                        description: 'Emits an audit log entry and returns a simple payload so clients can verify log routing (stderr + notification).',
                        inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'Optional message to include in log' } } },
                        outputSchema: { type: 'object', properties: { logged: { type: 'boolean' }, message: { type: 'string' }, timestamp: { type: 'string' } }, required: ['logged','timestamp'] },
                        annotations: { audience: ['assistant'], priority: 0.1 }
                    },
                    {
                        name: 'powershell-command',
                        title: 'PowerShell Command Executor',
                        description: 'Execute a single PowerShell command with enterprise security, audit logging, and timeout control. Supports working directory specification and security confirmation for risky operations.',
                        inputSchema: zodToJsonSchema(PowerShellCommandSchema),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean', description: 'Whether the command executed successfully' },
                                output: { type: 'string', description: 'Command output or error message' },
                                exitCode: { type: 'number', description: 'PowerShell exit code' },
                                executionTime: { type: 'number', description: 'Execution time in milliseconds' },
                                securityAssessment: {
                                    type: 'object',
                                    properties: {
                                        level: { type: 'string', enum: ['SAFE', 'RISKY', 'DANGEROUS', 'CRITICAL', 'BLOCKED', 'UNKNOWN'], description: 'Security classification level' },
                                        reason: { type: 'string', description: 'Explanation for security classification' },
                                        blocked: { type: 'boolean', description: 'Whether command was blocked by security policy' }
                                    },
                                    required: ['level', 'reason', 'blocked']
                                },
                                auditId: { type: 'string', description: 'Unique identifier for audit trail' }
                            },
                            required: ['success', 'output', 'securityAssessment']
                        },
                        annotations: {
                            audience: ['assistant'],
                            priority: 0.8,
                            security: {
                                requiresConfirmation: true,
                                auditLogged: true,
                                classification: 'dynamic'
                            }
                        }
                    },
                    {
                        name: 'enforce-working-directory',
                        title: 'Working Directory Enforcement Control',
                        description: 'Enable or disable the working directory enforcement security policy. When enabled, all commands with workingDirectory must resolve under configured allowedWriteRoots paths.',
                        inputSchema: zodToJsonSchema(z.object({
                            enabled: z.boolean().describe('Enable (true) or disable (false) working directory enforcement'),
                            key: z.string().optional().describe('Authentication key (required if server has authentication enabled)')
                        })),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean', description: 'Whether the operation succeeded' },
                                previousState: { type: 'boolean', description: 'Previous enforcement state' },
                                newState: { type: 'boolean', description: 'New enforcement state' },
                                message: { type: 'string', description: 'Status message' }
                            },
                            required: ['success', 'previousState', 'newState', 'message']
                        },
                        annotations: {
                            audience: ['assistant'],
                            priority: 0.5,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: true,
                                classification: 'administrative'
                            }
                        }
                    },
                    {
                        name: 'get-working-directory-policy',
                        title: 'Working Directory Policy Status',
                        description: 'Get the current working directory enforcement policy status, configuration, and allowed root paths for security compliance.',
                        inputSchema: zodToJsonSchema(z.object({
                            key: z.string().optional().describe('Authentication key (required if server has authentication enabled)')
                        })),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                enforceWorkingDirectory: { type: 'boolean', description: 'Whether working directory enforcement is enabled' },
                                status: { type: 'string', enum: ['ENFORCED', 'DISABLED'], description: 'Current enforcement status' },
                                allowedWriteRoots: { type: 'array', items: { type: 'string' }, description: 'List of allowed root directories' },
                                description: { type: 'string', description: 'Human-readable policy description' }
                            },
                            required: ['enforceWorkingDirectory', 'status', 'allowedWriteRoots', 'description']
                        },
                        annotations: {
                            audience: ['assistant', 'user'],
                            priority: 0.8,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: false,
                                classification: 'safe'
                            }
                        }
                    },
                    {
                        name: 'powershell-script',
                        title: 'PowerShell Script Executor', 
                        description: 'Execute multi-line PowerShell scripts with comprehensive security assessment, audit trail, and enterprise controls. Ideal for complex operations requiring multiple commands.',
                        inputSchema: zodToJsonSchema(PowerShellScriptSchema),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean', description: 'Whether the script executed successfully' },
                                output: { type: 'string', description: 'Script output or error message' },
                                exitCode: { type: 'number', description: 'PowerShell exit code' },
                                executionTime: { type: 'number', description: 'Execution time in milliseconds' },
                                securityAssessment: {
                                    type: 'object',
                                    properties: {
                                        level: { type: 'string', enum: ['SAFE', 'RISKY', 'DANGEROUS', 'CRITICAL', 'BLOCKED', 'UNKNOWN'], description: 'Security classification level' },
                                        reason: { type: 'string', description: 'Explanation for security classification' },
                                        blocked: { type: 'boolean', description: 'Whether script was blocked by security policy' }
                                    },
                                    required: ['level', 'reason', 'blocked']
                                },
                                auditId: { type: 'string', description: 'Unique identifier for audit trail' }
                            },
                            required: ['success', 'output', 'securityAssessment']
                        },
                        annotations: {
                            audience: ['assistant'],
                            priority: 0.7,
                            security: {
                                requiresConfirmation: true,
                                auditLogged: true,
                                classification: 'dynamic'
                            }
                        }
                    },
                    {
                        name: 'powershell-file',
                        title: 'PowerShell File Executor',
                        description: 'Execute PowerShell script files (.ps1) with parameter support, security analysis, and audit logging. Supports complex scripts with parameter requirements.',
                        inputSchema: zodToJsonSchema(PowerShellFileSchema),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean', description: 'Whether the file executed successfully' },
                                output: { type: 'string', description: 'File execution output or error message' },
                                exitCode: { type: 'number', description: 'PowerShell exit code' },
                                executionTime: { type: 'number', description: 'Execution time in milliseconds' },
                                filePath: { type: 'string', description: 'Path to executed file' },
                                securityAssessment: {
                                    type: 'object',
                                    properties: {
                                        level: { type: 'string', enum: ['SAFE', 'RISKY', 'DANGEROUS', 'CRITICAL', 'BLOCKED', 'UNKNOWN'], description: 'Security classification level' },
                                        reason: { type: 'string', description: 'Explanation for security classification' },
                                        blocked: { type: 'boolean', description: 'Whether file execution was blocked by security policy' }
                                    },
                                    required: ['level', 'reason', 'blocked']
                                },
                                auditId: { type: 'string', description: 'Unique identifier for audit trail' }
                            },
                            required: ['success', 'output', 'securityAssessment', 'filePath'
                            ]
                        },
                        annotations: {
                            audience: ['assistant'],
                            priority: 0.6,
                            security: {
                                requiresConfirmation: true,
                                auditLogged: true,
                                classification: 'dynamic',
                                fileAccess: true
                            }
                        }
                    },
                    {
                        name: 'powershell-syntax-check',
                        title: 'PowerShell Syntax Validator',
                        description: 'Validate PowerShell script syntax without execution. Provides syntax error detection and validation for development and pre-execution checks.',
                        inputSchema: zodToJsonSchema(SyntaxCheckSchema),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                isValid: { type: 'boolean', description: 'Whether the syntax is valid' },
                                errors: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            line: { type: 'number', description: 'Line number of error' },
                                            column: { type: 'number', description: 'Column number of error' },
                                            message: { type: 'string', description: 'Error message' },
                                            severity: { type: 'string', enum: ['Error', 'Warning', 'Information'], description: 'Error severity' }
                                        },
                                        required: ['line', 'column', 'message', 'severity']
                                    },
                                    description: 'List of syntax errors found'
                                },
                                suggestions: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Suggestions for fixing syntax errors'
                                }
                            },
                            required: ['isValid', 'errors']
                        },
                        annotations: {
                            audience: ['assistant', 'user'],
                            priority: 0.9,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: true,
                                classification: 'safe'
                            }
                        }
                    },
                    {
                        name: 'help',
                        title: 'Enterprise Help System',
                        description: 'Get comprehensive help documentation about server capabilities, security policies, usage examples, and AI agent integration guidance. Supports topic-specific help.',
                        inputSchema: zodToJsonSchema(HelpSchema),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                topic: { type: 'string', description: 'Help topic requested (or "comprehensive" for all)' },
                                content: { type: 'string', description: 'Help content in markdown format' },
                                availableTopics: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'List of available help topics'
                                }
                            },
                            required: ['topic', 'content', 'availableTopics']
                        },
                        annotations: {
                            audience: ['assistant', 'user'],
                            priority: 1.0,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: false,
                                classification: 'safe'
                            }
                        }
                    },
                    {
                        name: 'ai-agent-test',
                        title: 'AI Agent Testing Framework',
                        description: 'Run comprehensive validation tests to verify server functionality, security enforcement, and capabilities. Tests all security levels safely with configurable test suites.',
                        inputSchema: zodToJsonSchema(AITestSchema),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                testSuite: { type: 'string', description: 'Name of test suite executed' },
                                timestamp: { type: 'string', description: 'ISO timestamp of test execution' },
                                serverPid: { type: 'number', description: 'Server process ID' },
                                skipDangerous: { type: 'boolean', description: 'Whether dangerous tests were skipped' },
                                totalTests: { type: 'number', description: 'Total number of tests run' },
                                passed: { type: 'number', description: 'Number of tests passed' },
                                failed: { type: 'number', description: 'Number of tests failed' },
                                summary: {
                                    type: 'object',
                                    properties: {
                                        successRate: { type: 'string', description: 'Success percentage as string' },
                                        securityEnforcement: { type: 'string', enum: ['WORKING', 'NEEDS_REVIEW'], description: 'Security enforcement status' },
                                        safeExecution: { type: 'string', enum: ['WORKING', 'NEEDS_REVIEW'], description: 'Safe execution status' }
                                    },
                                    required: ['successRate', 'securityEnforcement', 'safeExecution']
                                }
                            },
                            required: ['testSuite', 'timestamp', 'serverPid', 'skipDangerous', 'totalTests', 'passed', 'failed', 'summary']
                        },
                        annotations: {
                            audience: ['assistant', 'user'],
                            priority: 0.6,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: true,
                                classification: 'testing'
                            }
                        }
                    },
                    {
                        name: 'threat-analysis',
                        title: 'Security Threat Analytics',
                        description: 'Get detailed threat tracking statistics including unknown commands, alias detection, suspicious patterns, and security risk analysis for audit and monitoring.',
                        inputSchema: zodToJsonSchema(z.object({
                            includeDetails: z.boolean().optional().describe('Include detailed threat entries in response'),
                            resetStats: z.boolean().optional().describe('Reset threat tracking statistics after retrieval'),
                            key: z.string().optional().describe('Authentication key (required if server has authentication enabled)')
                        })),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                unknownCommands: { type: 'number', description: 'Count of unknown/unclassified commands' },
                                aliasesDetected: { type: 'number', description: 'Count of PowerShell aliases detected' },
                                suspiciousPatterns: { type: 'number', description: 'Count of suspicious command patterns' },
                                threatLevel: { type: 'string', enum: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'], description: 'Overall threat assessment level' },
                                details: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            type: { type: 'string', description: 'Type of threat detected' },
                                            command: { type: 'string', description: 'Command or pattern detected' },
                                            timestamp: { type: 'string', description: 'When threat was detected' },
                                            severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], description: 'Severity level' }
                                        }
                                    },
                                    description: 'Detailed threat entries (if includeDetails is true)'
                                }
                            },
                            required: ['unknownCommands', 'aliasesDetected', 'suspiciousPatterns', 'threatLevel']
                        },
                        annotations: {
                            audience: ['assistant'],
                            priority: 0.4,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: true,
                                classification: 'administrative'
                            }
                        }
                    },
                    {
                        name: 'server-stats',
                        title: 'Server Runtime Metrics',
                        description: 'Retrieve comprehensive server performance and usage metrics including command counts by security level, execution times, threat statistics, and dynamic pattern overrides.',
                        inputSchema: zodToJsonSchema(z.object({
                            reset: z.boolean().optional().describe('Reset metrics after retrieval'),
                            key: z.string().optional().describe('Authentication key (required if server has authentication enabled)')
                        })),
                        outputSchema: {
                            type: 'object',
                            properties: {
                                uptimeSeconds: { type: 'number', description: 'Server uptime in seconds' },
                                metrics: {
                                    type: 'object',
                                    properties: {
                                        totalCommands: { type: 'number', description: 'Total commands executed' },
                                        safeCommands: { type: 'number', description: 'Safe commands executed' },
                                        riskyCommands: { type: 'number', description: 'Risky commands executed' },
                                        dangerousCommands: { type: 'number', description: 'Dangerous commands executed' },
                                        criticalCommands: { type: 'number', description: 'Critical commands executed' },
                                        blockedCommands: { type: 'number', description: 'Blocked commands' },
                                        truncatedOutputs: { type: 'number', description: 'Truncated outputs count' },
                                        averageDurationMs: { type: 'number', description: 'Average execution duration in milliseconds' }
                                    },
                                    required: ['totalCommands', 'safeCommands', 'riskyCommands', 'dangerousCommands', 'criticalCommands', 'blockedCommands', 'truncatedOutputs', 'averageDurationMs']
                                }
                            },
                            required: ['uptimeSeconds', 'metrics']
                        },
                        annotations: {
                            audience: ['assistant'],
                            priority: 0.3,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: false,
                                classification: 'safe'
                            }
                        }
                    },
                    {
                        name: 'agent-prompts',
                        title: 'Prompt Library Retrieval',
                        description: 'Retrieve phase-based reproduction prompts from docs/AGENT-PROMPTS.md. Supports optional category filter and markdown or JSON formatted output.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                category: { type: 'string', description: 'Optional case-insensitive substring to match a specific phase/category heading' },
                                format: { type: 'string', enum: ['markdown', 'json'], description: 'Output format (default markdown)' },
                                key: { type: 'string', description: 'Authentication key (required if server has authentication enabled)' }
                            },
                            required: []
                        },
                        outputSchema: {
                            type: 'object',
                            properties: {
                                format: { type: 'string', enum: ['markdown', 'json'], description: 'Format of returned content' },
                                categories: { type: 'array', items: { type: 'string' }, description: 'All detected prompt category headings' },
                                category: { type: 'string', description: 'Matched category (if filter applied)' },
                                content: { type: 'string', description: 'Prompt content (markdown or JSON stringified)' }
                            },
                            required: ['format', 'categories', 'content']
                        },
                        annotations: {
                            audience: ['assistant', 'user'],
                            priority: 0.95,
                            security: {
                                requiresConfirmation: false,
                                auditLogged: false,
                                classification: 'safe'
                            }
                        }
                    },
                ] as Tool[],
            };
        });

        // Handle tool execution requests
        this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
            const { name, arguments: args } = request.params;
            this.commandCount++;

            // Enhanced request tracking
            const requestId = `req_${Date.now()}_${this.commandCount}`;
            const clientInfo = this.getClientInfo();
            const requestInfo = {
                requestId,
                toolName: name,
                commandNumber: this.commandCount,
                timestamp: new Date().toISOString(),
                hasArguments: !!args,
                argumentKeys: args ? Object.keys(args) : [],
                serverUptime: Math.round((Date.now() - this.startTime.getTime()) / 1000) + 's',
                clientPid: clientInfo.parentPid,
                serverPid: clientInfo.serverPid,
                connectionId: clientInfo.connectionId
            };

            // Enhanced request logging
            console.error("─".repeat(50));
            console.error(`🔄 REQUEST #${this.commandCount} [${requestId}]`);
            console.error(`🛠️  Tool: ${name}`);
            console.error(`⏰ Time: ${requestInfo.timestamp}`);
            console.error(`📊 Server Uptime: ${requestInfo.serverUptime}`);
            console.error(`🔗 Client PID: ${clientInfo.parentPid} → Server PID: ${clientInfo.serverPid}`);
            if (args) {
                console.error(`📋 Arguments: ${JSON.stringify(args, null, 2)}`);
            }

            // Enhanced request info including command details
            const enhancedRequestInfo = {
                ...requestInfo,
                ...(args?.command && { command: args.command }),
                ...(args?.script && { script: args.script.substring(0, 200) + (args.script.length > 200 ? '...' : '') }),
                ...(args?.filePath && { filePath: args.filePath })
            };

            auditLog('INFO', 'MCP_REQUEST', `Enterprise tool request: ${name}`, enhancedRequestInfo);

            try {
                // Validate authentication before processing any tool - support both 'key' and legacy 'authKey'
                const key = args?.key || args?.authKey;
                if (!this.validateAuthKey(key)) {
                    auditLog('ERROR', 'AUTH_FAILED', `Authentication failed for request ${requestId}`, {
                        requestId,
                        toolName: name,
                        hasProvidedKey: !!key,
                        expectedKeyLength: this.authKey?.length || 0,
                        serverMode: 'enterprise'
                    });
                    console.error(`❌ AUTHENTICATION FAILED for ${name}`);
                    throw new McpError(
                        ErrorCode.InvalidRequest,
                        `Authentication failed. ${this.authKey ? 'Valid authentication key required for enterprise mode.' : 'Server running in development mode.'}`
                    );
                }

                console.error(`✅ Enterprise authentication passed for ${name}`);

                // Rate limiting
                const rl = this.enforceRateLimit(clientInfo.parentPid);
                if (!rl.allowed) {
                    auditLog('WARNING', 'RATE_LIMIT_EXCEEDED', 'Client exceeded rate limit', {
                        clientPid: clientInfo.parentPid,
                        toolName: name,
                        resetMs: rl.resetMs
                    });
                                        // Emit rate limit as BLOCKED event to dashboard
                                        try { metricsHttpServer.publishExecution({
                                            id: requestId,
                                            level: 'BLOCKED',
                                            durationMs: 0,
                                            blocked: true,
                                            truncated: false,
                                            timestamp: new Date().toISOString(),
                                            preview: '[RATE LIMIT]',
                                            success: false,
                                            exitCode: null
                                        }); metricsRegistry.record({ level: 'BLOCKED' as any, blocked: true, durationMs: 0, truncated: false }); } catch {}
                                        throw new McpError(
                                                ErrorCode.InvalidRequest,
                                                `Rate limit exceeded. Try again in ${rl.resetMs}ms.`
                                        );
                }
                enhancedRequestInfo['rateLimit'] = { remaining: rl.remaining, resetMs: rl.resetMs };

                // Route to appropriate handler
                switch (name) {
                    case 'log-test': {
                        const msg = (args?.message && typeof args.message === 'string') ? args.message : 'Log test ping';
                        const ts = new Date().toISOString();
                        console.error(`🧪 LOG-TEST: ${msg} @ ${ts}`);
                        auditLog('INFO', 'LOG_TEST', 'Log test tool invoked', { message: msg, requestId });
                        return {
                            content: [{ type: 'text', text: `Log test emitted at ${ts}: ${msg}` }],
                            structuredContent: { logged: true, message: msg, timestamp: ts }
                        };
                    }
                    case 'agent-prompts': {
                        const categoryFilter = args?.category as string | undefined;
                        const format = (args?.format as string | undefined) === 'json' ? 'json' : 'markdown';
                        const promptsPath = path.join(process.cwd(), 'docs', 'AGENT-PROMPTS.md');
                        if (!fs.existsSync(promptsPath)) {
                            throw new McpError(ErrorCode.InvalidRequest, 'Prompt library file not found at docs/AGENT-PROMPTS.md');
                        }
                        const raw = fs.readFileSync(promptsPath, 'utf8');
                        // Extract headings starting with '## ' (ignore top-level # )
                        const lines = raw.split(/\r?\n/);
                        const headings: { line: number; text: string }[] = [];
                        lines.forEach((l, idx) => {
                            const m = l.match(/^##\s+(.+?)\s*$/);
                            if (m) headings.push({ line: idx, text: m[1].trim() });
                        });
                        const categories = headings.map(h => h.text);
                        let selectedContent = raw;
                        let matchedCategory: string | undefined;
                        if (categoryFilter) {
                            const match = headings.find(h => h.text.toLowerCase().includes(categoryFilter.toLowerCase()));
                            if (match) {
                                matchedCategory = match.text;
                                const start = match.line;
                                // find next heading or end
                                const next = headings.find(h => h.line > start);
                                const endLine = next ? next.line : lines.length;
                                selectedContent = lines.slice(start, endLine).join('\n');
                            } else {
                                selectedContent = `# No category match for filter: ${categoryFilter}`;
                            }
                        }
                        let outputContent: string;
                        if (format === 'json') {
                            const payload = categoryFilter && matchedCategory ? { category: matchedCategory, content: selectedContent } : { categories, content: selectedContent };
                            outputContent = JSON.stringify(payload, null, 2);
                        } else {
                            outputContent = selectedContent;
                        }
                        return {
                            content: [{ type: 'text', text: outputContent }],
                            structuredContent: {
                                format,
                                categories,
                                ...(matchedCategory ? { category: matchedCategory } : {}),
                                content: outputContent
                            }
                        };
                    }
                    case 'enforce-working-directory': {
                        if (!('enabled' in args) || typeof args.enabled !== 'boolean') {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing boolean "enabled" parameter');
                        }
                        const oldValue = ENTERPRISE_CONFIG.security.enforceWorkingDirectory;
                        ENTERPRISE_CONFIG.security.enforceWorkingDirectory = args.enabled;
                        auditLog('INFO', 'WORKING_DIRECTORY_POLICY_CHANGED', `Working directory enforcement ${args.enabled ? 'enabled' : 'disabled'}`, { 
                            oldValue, 
                            newValue: args.enabled 
                        });
                        return { 
                            content: [{ 
                                type: 'text', 
                                text: `Working directory enforcement ${args.enabled ? 'enabled' : 'disabled'}.\n\nWhen enabled, all commands with workingDirectory must resolve under configured allowedWriteRoots.\nCurrent status: ${args.enabled ? 'ENFORCED' : 'DISABLED'}` 
                            }],
                            structuredContent: {
                                success: true,
                                previousState: oldValue,
                                newState: args.enabled,
                                message: `Working directory enforcement ${args.enabled ? 'enabled' : 'disabled'}`
                            }
                        };
                    }
                    case 'get-working-directory-policy': {
                        const policy = {
                            enforceWorkingDirectory: ENTERPRISE_CONFIG.security.enforceWorkingDirectory,
                            status: ENTERPRISE_CONFIG.security.enforceWorkingDirectory ? 'ENFORCED' : 'DISABLED',
                            allowedWriteRoots: ENTERPRISE_CONFIG.security.allowedWriteRoots || [],
                            description: ENTERPRISE_CONFIG.security.enforceWorkingDirectory 
                                ? 'Working directory enforcement is ACTIVE. Commands with workingDirectory must resolve under allowedWriteRoots.'
                                : 'Working directory enforcement is DISABLED. Commands can use any workingDirectory.'
                        };
                        return { 
                            content: [{ 
                                type: 'text', 
                                text: JSON.stringify(policy, null, 2) 
                            }],
                            structuredContent: policy
                        };
                    }
                    case 'server-stats': {
                        const reset = args?.reset;
                        const snapshot = {
                            uptimeSeconds: Math.round((Date.now() - this.startTime.getTime())/1000),
                            metrics: {
                                ...this.metrics,
                                averageDurationMs: this.metrics.durationsMs.length ? Math.round(this.metrics.durationsMs.reduce((a,b)=>a+b,0)/this.metrics.durationsMs.length) : 0,
                                registry: metricsRegistry.snapshot(!!reset)
                            },
                            threatStats: this.getThreatStats(),
                            dynamicPatterns: {
                                enabled: !!(ENTERPRISE_CONFIG.security.additionalSafe?.length || ENTERPRISE_CONFIG.security.additionalBlocked?.length || ENTERPRISE_CONFIG.security.suppressPatterns?.length),
                                additionalSafe: ENTERPRISE_CONFIG.security.additionalSafe || [],
                                additionalBlocked: ENTERPRISE_CONFIG.security.additionalBlocked || [],
                                suppressPatterns: ENTERPRISE_CONFIG.security.suppressPatterns || []
                            },
                            rateLimit: ENTERPRISE_CONFIG.rateLimit || { enabled: false },
                            timestamp: new Date().toISOString()
                        };
                        if (reset) {
                            this.metrics = { commands:0, executions:0, blocked:0, truncated:0, byLevel:{SAFE:0,RISKY:0,DANGEROUS:0,CRITICAL:0,BLOCKED:0,UNKNOWN:0}, durationsMs:[], lastReset:new Date().toISOString() };
                        }
                        auditLog('INFO', 'SERVER_STATS', 'Server metrics retrieved', { reset, snapshot });
                        return { 
                            content: [{ type:'text', text: JSON.stringify(snapshot,null,2) }],
                            structuredContent: snapshot
                        };
                    }
                    case 'powershell-command': {
                        const validatedArgs = PowerShellCommandSchema.parse(args);
                        
                        // Security assessment
                        const securityAssessment = this.classifyCommandSafety(validatedArgs.command);
                        
                        console.error(`🔨 Executing PowerShell Command: ${validatedArgs.command}`);
                        const commandTimeout = validatedArgs.aiAgentTimeout || validatedArgs.timeout || ENTERPRISE_CONFIG.limits.defaultTimeoutMs;
                        console.error(`⏱️  Timeout: ${commandTimeout}ms${validatedArgs.aiAgentTimeout ? ' (AI Agent Override)' : ''}`);
                        console.error(`[DEBUG] Received timeout params => timeout: ${validatedArgs.timeout ?? 'undefined'} aiAgentTimeout: ${validatedArgs.aiAgentTimeout ?? 'undefined'}`);
                        console.error(`🛡️  Security Level: ${securityAssessment.level} (${securityAssessment.risk} RISK)`);
                        console.error(`📋 Risk Reason: ${securityAssessment.reason}`);
                        console.error(`🎨 Classification Color: ${securityAssessment.color}`);
                        
                        if (validatedArgs.workingDirectory) {
                            console.error(`📁 Working Directory: ${validatedArgs.workingDirectory}`);
                        }
                        
                        // Security enforcement
                        if (securityAssessment.blocked) {
                            const blockedError = new McpError(
                                ErrorCode.InvalidRequest,
                                `🚫 COMMAND BLOCKED: ${securityAssessment.reason}`
                            );
                            
                            console.error(`🚫 BLOCKED: ${securityAssessment.category} - ${securityAssessment.reason}`);
                            
                            auditLog('ERROR', 'COMMAND_BLOCKED', 'Enterprise security policy blocked command execution', {
                                requestId,
                                command: validatedArgs.command,
                                securityLevel: securityAssessment.level,
                                riskLevel: securityAssessment.risk,
                                reason: securityAssessment.reason,
                                category: securityAssessment.category,
                                clientPid: clientInfo.parentPid,
                                serverPid: clientInfo.serverPid,
                                blockingPolicy: 'ENTERPRISE_SECURITY_ENFORCEMENT'
                            });
                                                        try { metricsHttpServer.publishExecution({
                                                            id: requestId,
                                                            level: 'BLOCKED',
                                                            durationMs: 0,
                                                            blocked: true,
                                                            truncated: false,
                                                            timestamp: new Date().toISOString(),
                                                            preview: validatedArgs.command.substring(0,120),
                                                            success: false,
                                                            exitCode: null
                                                        }); metricsRegistry.record({ level: 'BLOCKED' as any, blocked: true, durationMs: 0, truncated: false }); } catch {}
                            throw blockedError;
                        }
                        
                        // Handle confirmation requirements
                        if (securityAssessment.requiresPrompt && !validatedArgs.confirmed && !validatedArgs.override) {
                            const promptError = new McpError(
                                ErrorCode.InvalidRequest,
                                `⚠️ CONFIRMATION REQUIRED: ${securityAssessment.reason}. Add 'confirmed: true' to proceed or 'override: true' with proper authorization.`
                            );
                            
                            console.error(`⚠️ CONFIRMATION REQUIRED for ${securityAssessment.category}`);
                            
                            auditLog('WARNING', 'CONFIRMATION_REQUIRED', 'Command requires user confirmation to proceed', {
                                requestId,
                                command: validatedArgs.command,
                                securityLevel: securityAssessment.level,
                                riskLevel: securityAssessment.risk,
                                reason: securityAssessment.reason,
                                category: securityAssessment.category,
                                confirmationInstructions: 'Add confirmed: true parameter'
                            });
                                                        try { metricsHttpServer.publishExecution({
                                                            id: requestId,
                                                            level: securityAssessment.level,
                                                            durationMs: 0,
                                                            blocked: false,
                                                            truncated: false,
                                                            timestamp: new Date().toISOString(),
                                                            preview: validatedArgs.command.substring(0,120)+' [CONFIRM?]',
                                                            success: false,
                                                            exitCode: null
                                                        }); metricsRegistry.record({ level: 'UNKNOWN' as any, blocked:false, durationMs:0, truncated:false });
                                                        // Increment confirmation-specific counter directly (not tied to level)
                                                        try { (metricsRegistry as any).counts.CONFIRM++; } catch {}
                                                        } catch {}
                            throw promptError;
                        }
                        
                        // Execute the command with appropriate timeout
                        console.error(`🚀 Executing enterprise PowerShell command...`);
                        const result = await this.executePowerShellCommand(
                            validatedArgs.command,
                            commandTimeout,
                            validatedArgs.workingDirectory
                        );
                        
                        result.securityAssessment = securityAssessment;
                        // metrics update
                        this.metrics.commands++;
                        this.metrics.executions++;
                        this.metrics.byLevel[securityAssessment.level]++;
                        if (securityAssessment.blocked) this.metrics.blocked++;
                        if (result.error && result.error.includes('TRUNCATED')) this.metrics.truncated++;
                        if (result.duration_ms) this.metrics.durationsMs.push(result.duration_ms);
                        metricsRegistry.record({
                          level: securityAssessment.level,
                          blocked: securityAssessment.blocked,
                          durationMs: result.duration_ms,
                          truncated: !!(result.error && result.error.includes('TRUNCATED'))
                        });
                                                metricsHttpServer.publishExecution({
                                                    id: requestId,
                                                    level: securityAssessment.level,
                                                    durationMs: result.duration_ms,
                                                    blocked: securityAssessment.blocked,
                                                    truncated: !!(result.error && result.error.includes('TRUNCATED')),
                                                    timestamp: new Date().toISOString(),
                                                    preview: validatedArgs.command?.substring(0,120),
                                                    success: result.success,
                                                    exitCode: result.exitCode,
                                                    confirmed: validatedArgs.confirmed || validatedArgs.override,
                                                    timedOut: result.timedOut
                                                });
                        if (result.timedOut) { try { (metricsRegistry as any).counts.TIMEOUTS++; } catch {} }
                        
                        // Enhanced result logging
                        console.error(`✅ COMMAND COMPLETED [${requestId}]`);
                        console.error(`📊 Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
                        if (result.duration_ms) console.error(`⏱️  Duration: ${result.duration_ms}ms`);
                        if (result.exitCode !== undefined) console.error(`🔢 Exit Code: ${result.exitCode}`);
                        console.error("─".repeat(50));
                        
                        // Comprehensive audit logging with ACTUAL COMMAND AND RESPONSE
                        auditLog('INFO', 'MCP_RESPONSE', `Enterprise tool response: ${name}`, {
                            requestId,
                            toolName: name,
                            command: validatedArgs.command, // THE ACTUAL POWERSHELL COMMAND
                            success: result.success,
                            exitCode: result.exitCode,
                            stdout: result.stdout, // THE ACTUAL COMMAND OUTPUT
                            stderr: result.stderr, // THE ACTUAL ERROR OUTPUT
                            outputLength: result.stdout?.length || 0,
                            errorLength: result.stderr?.length || 0,
                            duration_ms: result.duration_ms,
                            securityLevel: securityAssessment.level,
                            riskLevel: securityAssessment.risk,
                            category: securityAssessment.category,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid,
                            workingDirectory: validatedArgs.workingDirectory,
                            truncated: !!(result.error && result.error.includes('TRUNCATED'))
                        });
                        
                        return {
                            content: [
                                { type: 'text' as const, text: JSON.stringify(result, null, 2) },
                                { type: 'text' as const, text: `SUMMARY: elapsed=${result.duration_ms}ms configuredTimeout=${result.configuredTimeoutMs}ms timedOut=${result.timedOut||false} killEscalated=${result.killEscalated||false}` }
                            ],
                            structuredContent: {
                                success: result.success,
                                output: (() => {
                                    const base = result.stdout || result.stderr || '';
                                    if (result.timedOut) {
                                        return `[TIMEOUT] Command exceeded ${result.configuredTimeoutMs}ms (elapsed ${result.duration_ms}ms${result.killEscalated ? ' - escalated' : ''}).` + (base ? `\n${base}` : '');
                                    }
                                    return base;
                                })(),
                                exitCode: result.exitCode,
                                executionTime: result.duration_ms,
                                executionStartIso: new Date(Date.now() - (result.duration_ms || 0)).toISOString(),
                                executionEndIso: new Date().toISOString(),
                                securityAssessment: {
                                    level: securityAssessment.level,
                                    reason: securityAssessment.reason,
                                    blocked: securityAssessment.blocked
                                },
                                auditId: requestId,
                                timedOut: result.timedOut || false,
                                configuredTimeoutMs: result.configuredTimeoutMs,
                                killEscalated: result.killEscalated || false,
                                truncated: !!(result.error && result.error.includes('TRUNCATED')),
                                error: result.error
                            }
                        };
                    }
                    
                    case 'powershell-script': {
                        const validatedArgs = PowerShellScriptSchema.parse(args);
                        
                        // Security assessment for scripts
                        const securityAssessment = this.classifyCommandSafety(validatedArgs.script);
                        
                        console.error(`📜 Executing PowerShell Script (${validatedArgs.script.length} characters)`);
                        const scriptTimeout = validatedArgs.aiAgentTimeout || validatedArgs.timeout || ENTERPRISE_CONFIG.limits.defaultTimeoutMs;
                        console.error(`⏱️  Timeout: ${scriptTimeout}ms${validatedArgs.aiAgentTimeout ? ' (AI Agent Override)' : ''}`);
                        console.error(`[DEBUG] Received timeout params => timeout: ${validatedArgs.timeout ?? 'undefined'} aiAgentTimeout: ${validatedArgs.aiAgentTimeout ?? 'undefined'}`);
                        console.error(`🛡️  Security Level: ${securityAssessment.level} (${securityAssessment.risk} RISK)`);
                        
                        // Security enforcement for scripts
                        if (securityAssessment.blocked) {
                            const blockedError = new McpError(
                                ErrorCode.InvalidRequest,
                                `🚫 SCRIPT BLOCKED: ${securityAssessment.reason}`
                            );
                            
                            console.error(`🚫 BLOCKED: ${securityAssessment.category} - ${securityAssessment.reason}`);
                            
                            auditLog('ERROR', 'SCRIPT_BLOCKED', 'Enterprise security policy blocked script execution', {
                                requestId,
                                scriptLength: validatedArgs.script.length,
                                scriptPreview: validatedArgs.script.substring(0, 200) + (validatedArgs.script.length > 200 ? '...' : ''),
                                securityLevel: securityAssessment.level,
                                riskLevel: securityAssessment.risk,
                                reason: securityAssessment.reason,
                                category: securityAssessment.category,
                                clientPid: clientInfo.parentPid,
                                serverPid: clientInfo.serverPid,
                                blockingPolicy: 'ENTERPRISE_SECURITY_ENFORCEMENT'
                            });
                                                        try { metricsHttpServer.publishExecution({
                                                            id: requestId,
                                                            level: 'BLOCKED',
                                                            durationMs: 0,
                                                            blocked: true,
                                                            truncated: false,
                                                            timestamp: new Date().toISOString(),
                                                            preview: validatedArgs.script.substring(0,120),
                                                            success: false,
                                                            exitCode: null
                                                        }); metricsRegistry.record({ level: 'BLOCKED' as any, blocked: true, durationMs: 0, truncated: false }); } catch {}
                            throw blockedError;
                        }
                        
                        // Handle confirmation for scripts
                        if (securityAssessment.requiresPrompt && !validatedArgs.confirmed && !validatedArgs.override) {
                                                        try { metricsHttpServer.publishExecution({
                                                            id: requestId,
                                                            level: securityAssessment.level,
                                                            durationMs: 0,
                                                            blocked: false,
                                                            truncated: false,
                                                            timestamp: new Date().toISOString(),
                                                            preview: validatedArgs.script.substring(0,120)+' [CONFIRM?]',
                                                            success: false,
                                                            exitCode: null
                                                        }); metricsRegistry.record({ level: 'UNKNOWN' as any, blocked:false, durationMs:0, truncated:false });
                                                        try { (metricsRegistry as any).counts.CONFIRM++; } catch {}
                                                        } catch {}
                                                        throw new McpError(
                                                                ErrorCode.InvalidRequest,
                                                                `⚠️ SCRIPT CONFIRMATION REQUIRED: ${securityAssessment.reason}. Add 'confirmed: true' to proceed.`
                                                        );
                        }
                        
                        // Execute the script with appropriate timeout
                        const result = await this.executePowerShellCommand(
                            validatedArgs.script,
                            scriptTimeout,
                            validatedArgs.workingDirectory
                        );
                        
                        result.securityAssessment = securityAssessment;
                        this.metrics.commands++;
                        this.metrics.executions++;
                        this.metrics.byLevel[securityAssessment.level]++;
                        if (securityAssessment.blocked) this.metrics.blocked++;
                        if (result.error && result.error.includes('TRUNCATED')) this.metrics.truncated++;
                        if (result.duration_ms) this.metrics.durationsMs.push(result.duration_ms);
                        metricsRegistry.record({
                          level: securityAssessment.level,
                          blocked: securityAssessment.blocked,
                          durationMs: result.duration_ms,
                          truncated: !!(result.error && result.error.includes('TRUNCATED'))
                        });
                                                metricsHttpServer.publishExecution({
                                                    id: requestId,
                                                    level: securityAssessment.level,
                                                    durationMs: result.duration_ms,
                                                    blocked: securityAssessment.blocked,
                                                    truncated: !!(result.error && result.error.includes('TRUNCATED')),
                                                    timestamp: new Date().toISOString(),
                                                    preview: validatedArgs.script?.substring(0,120),
                                                    success: result.success,
                                                    exitCode: result.exitCode,
                                                    confirmed: validatedArgs.confirmed || validatedArgs.override,
                                                    timedOut: result.timedOut
                                                });
                        if (result.timedOut) { try { (metricsRegistry as any).counts.TIMEOUTS++; } catch {} }
                        
                        console.error(`✅ SCRIPT COMPLETED [${requestId}]`);
                        console.error(`📊 Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
                        console.error("─".repeat(50));
                        
                        // Add audit logging for script responses too
                        auditLog('INFO', 'MCP_RESPONSE', `Enterprise tool response: ${name}`, {
                            requestId,
                            toolName: name,
                            script: validatedArgs.script, // THE ACTUAL POWERSHELL SCRIPT
                            success: result.success,
                            exitCode: result.exitCode,
                            stdout: result.stdout, // THE ACTUAL SCRIPT OUTPUT
                            stderr: result.stderr, // THE ACTUAL ERROR OUTPUT
                            outputLength: result.stdout?.length || 0,
                            errorLength: result.stderr?.length || 0,
                            duration_ms: result.duration_ms,
                            securityLevel: securityAssessment.level,
                            riskLevel: securityAssessment.risk,
                            category: securityAssessment.category,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid,
                            workingDirectory: validatedArgs.workingDirectory,
                            truncated: !!(result.error && result.error.includes('TRUNCATED'))
                        });
                        
                        return {
                            content: [
                                { type: 'text' as const, text: JSON.stringify(result, null, 2) },
                                { type: 'text' as const, text: `SUMMARY: elapsed=${result.duration_ms}ms configuredTimeout=${result.configuredTimeoutMs}ms timedOut=${result.timedOut||false} killEscalated=${result.killEscalated||false}` }
                            ],
                            structuredContent: {
                                success: result.success,
                                output: (() => {
                                    const base = result.stdout || result.stderr || '';
                                    if (result.timedOut) {
                                        return `[TIMEOUT] Script exceeded ${result.configuredTimeoutMs}ms (elapsed ${result.duration_ms}ms${result.killEscalated ? ' - escalated' : ''}).` + (base ? `\n${base}` : '');
                                    }
                                    return base;
                                })(),
                                exitCode: result.exitCode,
                                executionTime: result.duration_ms,
                                executionStartIso: new Date(Date.now() - (result.duration_ms || 0)).toISOString(),
                                executionEndIso: new Date().toISOString(),
                                securityAssessment: {
                                    level: securityAssessment.level,
                                    reason: securityAssessment.reason,
                                    blocked: securityAssessment.blocked
                                },
                                auditId: requestId,
                                timedOut: result.timedOut || false,
                                configuredTimeoutMs: result.configuredTimeoutMs,
                                killEscalated: result.killEscalated || false,
                                truncated: !!(result.error && result.error.includes('TRUNCATED')),
                                error: result.error
                            }
                        };
                    }
                    
                    case 'powershell-syntax-check': {
                        const validatedArgs = SyntaxCheckSchema.parse(args);
                        
                        console.error(`🔍 Checking PowerShell Syntax (${validatedArgs.content.length} characters)`);
                        
                        const result = await this.checkPowerShellSyntax(validatedArgs.content);
                        
                        console.error(`✅ SYNTAX CHECK COMPLETED [${requestId}]`);
                        console.error(`📊 Valid: ${result.isValid ? 'YES' : 'NO'}`);
                        if (result.errors.length > 0) {
                            console.error(`❌ Errors: ${result.errors.length}`);
                        }
                        console.error("─".repeat(50));
                        
                        auditLog('INFO', 'SYNTAX_CHECK', `PowerShell syntax validation completed`, {
                            requestId,
                            isValid: result.isValid,
                            errorCount: result.errors.length,
                            warningCount: result.warnings.length,
                            contentLength: validatedArgs.content.length
                        });
                        
                        return {
                            content: [{ 
                                type: 'text' as const,
                                text: JSON.stringify(result, null, 2)
                            }],
                            structuredContent: {
                                isValid: result.isValid,
                                errors: result.errors,
                                suggestions: []
                            }
                        };
                    }
                    
                    case 'help': {
                        const validatedArgs = HelpSchema.parse(args);
                        
                        console.error(`📖 Generating Help Documentation`);
                        console.error(`📋 Topic: ${validatedArgs.topic}`);
                        
                        const helpContent = this.generateHelpForAIAgents(validatedArgs.topic);
                        
                        console.error(`✅ HELP GENERATED [${requestId}]`);
                        console.error(`📊 Content Length: ${helpContent.length} characters`);
                        console.error("─".repeat(50));
                        
                        auditLog('INFO', 'HELP_REQUEST', `Help documentation provided`, {
                            requestId,
                            topic: validatedArgs.topic || 'comprehensive',
                            contentLength: helpContent.length,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return {
                            content: [{ 
                                type: 'text' as const,
                                text: helpContent
                            }],
                            structuredContent: {
                                topic: validatedArgs.topic || 'comprehensive',
                                content: helpContent,
                                availableTopics: ['security', 'monitoring', 'authentication', 'examples', 'capabilities', 'ai-agents', 'working-directory']
                            }
                        };
                    }
                    
                    case 'ai-agent-test': {
                        const validatedArgs = AITestSchema.parse(args);
                        
                        console.error(`🧪 Running AI Agent Tests`);
                        console.error(`📋 Test Suite: ${validatedArgs.testSuite}`);
                        console.error(`🛡️  Skip Dangerous: ${validatedArgs.skipDangerous}`);
                        
                        const testResults = await this.runAIAgentTests(validatedArgs.testSuite, validatedArgs.skipDangerous);
                        
                        console.error(`✅ AI AGENT TESTS COMPLETED [${requestId}]`);
                        console.error(`📊 Results: ${testResults.passed}/${testResults.totalTests} passed (${testResults.summary.successRate})`);
                        console.error(`🛡️  Security Enforcement: ${testResults.summary.securityEnforcement}`);
                        console.error(`⚡ Safe Execution: ${testResults.summary.safeExecution}`);
                        console.error("─".repeat(50));
                        
                        auditLog('INFO', 'AI_AGENT_TEST', `AI agent validation tests completed`, {
                            requestId,
                            testSuite: validatedArgs.testSuite,
                            skipDangerous: validatedArgs.skipDangerous,
                            totalTests: testResults.totalTests,
                            passed: testResults.passed,
                            failed: testResults.failed,
                            successRate: testResults.summary.successRate,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return {
                            content: [{
                                type: 'text' as const,
                                text: JSON.stringify(testResults, null, 2)
                            }],
                            structuredContent: testResults
                        };
                    }
                    
                    case 'threat-analysis': {
                        const validatedArgs = z.object({
                            includeDetails: z.boolean().optional(),
                            resetStats: z.boolean().optional()
                        }).parse(args);
                        
                        console.error(`🔍 Generating Threat Analysis Report`);
                        console.error(`📊 Include Details: ${validatedArgs.includeDetails || false}`);
                        console.error(`🔄 Reset Stats: ${validatedArgs.resetStats || false}`);
                        
                        const threatStats = this.getThreatStats();
                        
                        const analysisReport = {
                            timestamp: new Date().toISOString(),
                            sessionId: this.sessionId,
                            serverUptime: Date.now() - this.startTime.getTime(),
                            commandsProcessed: this.commandCount,
                            statistics: threatStats,
                            assessment: {
                                overallRisk: threatStats.highRiskThreats > 5 ? 'HIGH' : 
                                            threatStats.uniqueThreats > 10 ? 'MEDIUM' : 'LOW',
                                threatLevel: threatStats.aliasesDetected > 0 ? 'ELEVATED' : 'NORMAL',
                                recommendation: threatStats.highRiskThreats > 0 ? 
                                    'Review high-risk threats immediately' : 
                                    'Threat level within normal parameters'
                            },
                            details: validatedArgs.includeDetails ? {
                                recentThreats: threatStats.recentThreats,
                                knownAliases: Object.keys(POWERSHELL_ALIAS_MAP).length,
                                suspiciousPatterns: SUSPICIOUS_ALIAS_PATTERNS.length
                            } : undefined
                        };
                        
                        // Reset statistics if requested
                        if (validatedArgs.resetStats) {
                            this.unknownThreats.clear();
                            this.threatStats = {
                                totalUnknownCommands: 0,
                                uniqueThreats: 0,
                                highRiskThreats: 0,
                                aliasesDetected: 0,
                                sessionsWithThreats: 0
                            };
                            console.error(`🔄 Threat tracking statistics have been reset`);
                        }
                        
                        console.error(`✅ THREAT ANALYSIS COMPLETED [${requestId}]`);
                        console.error(`⚠️  Risk Level: ${analysisReport.assessment.overallRisk}`);
                        console.error(`🚨 Threat Level: ${analysisReport.assessment.threatLevel}`);
                        console.error(`📊 Unique Threats: ${threatStats.uniqueThreats}`);
                        console.error(`🔍 Aliases Detected: ${threatStats.aliasesDetected}`);
                        console.error("─".repeat(50));
                        
                        auditLog('INFO', 'THREAT_ANALYSIS', 'Threat analysis report generated', {
                            requestId,
                            includeDetails: validatedArgs.includeDetails,
                            resetStats: validatedArgs.resetStats,
                            overallRisk: analysisReport.assessment.overallRisk,
                            uniqueThreats: threatStats.uniqueThreats,
                            highRiskThreats: threatStats.highRiskThreats,
                            aliasesDetected: threatStats.aliasesDetected,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return {
                            content: [{
                                type: 'text' as const,
                                text: JSON.stringify(analysisReport, null, 2)
                            }]
                        };
                    }
                    
                    default:
                        console.error(`❌ Unknown tool: ${name}`);
                        auditLog('ERROR', 'UNKNOWN_TOOL', `Unknown tool requested: ${name}`, { requestId });
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            } catch (error) {
                // Enhanced error logging
                console.error(`❌ REQUEST FAILED [${requestId}]`);
                console.error(`🛠️  Tool: ${name}`);
                console.error(`💥 Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
                console.error(`📝 Error Message: ${error instanceof Error ? error.message : String(error)}`);
                console.error("─".repeat(50));
                
                auditLog('ERROR', 'MCP_ERROR', `Enterprise tool execution failed: ${name}`, {
                    requestId,
                    toolName: name,
                    errorType: error instanceof Error ? error.constructor.name : typeof error,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
                
                if (error instanceof z.ZodError) {
                    console.error(`🔍 Validation Error Details: ${JSON.stringify(error.errors, null, 2)}`);
                    throw new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${error.message}`);
                }
                throw error;
            }
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
