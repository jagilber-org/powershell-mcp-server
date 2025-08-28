/**
 * DEPRECATED ADAPTER: vscode-server-enterprise.ts
 * Original monolithic implementation removed. Unified server lives in server.ts.
 */
import { EnterprisePowerShellMCPServer } from './server.js';
import { auditLog } from './logging/audit.js';

export { EnterprisePowerShellMCPServer } from './server.js';

async function main(){
    const authKey = process.env.MCP_AUTH_KEY;
    const server = new EnterprisePowerShellMCPServer(authKey);
    await server.start();
}

const invokedDirect = import.meta.url === `file://${process.argv[1]}` || /vscode-server-enterprise\.js$/i.test(process.argv[1]||'');
if(invokedDirect){
    main().catch(err=>{
        console.error('[deprecated-entry] fatal startup error', err);
        auditLog('ERROR','SERVER_FATAL_DEPRECATED','startup failed',{ error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
    });
}

// End of adapter file. (Legacy implementation fully removed.)
// Intentionally no additional exports.
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
    console.error(`≡ƒôì Process ID: ${systemInfo.pid}`);
    console.error(`≡ƒûÑ∩╕Å  Platform: ${systemInfo.platform} (${systemInfo.arch})`);
    console.error(`ΓÜí Node.js: ${systemInfo.nodeVersion}`);
    console.error(`≡ƒæñ User: ${systemInfo.user}@${systemInfo.hostname}`);
    console.error(`≡ƒôü Working Directory: ${systemInfo.cwd}`);
    console.error(`≡ƒÆ╛ Memory: ${systemInfo.freeMemory} free / ${systemInfo.totalMemory} total`);
    console.error(`≡ƒöº CPU: ${systemInfo.cpus}`);
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
    timeoutSeconds: z.number().int().positive().max(300).optional().default(90).describe('Timeout in seconds (default: 90, max: 300)'),
    workingDirectory: z.string().optional().describe('Working directory for command execution'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
    confirmed: z.boolean().optional().describe('Explicit confirmation for medium-risk commands (required for RISKY/UNKNOWN commands)'),
    override: z.boolean().optional().describe('Security override for authorized administrators (use with extreme caution)'),
});

/** PowerShell script execution schema */
const PowerShellScriptSchema = z.object({
    script: z.string().min(1).describe('PowerShell script content to execute'),
    timeoutSeconds: z.number().int().positive().max(300).optional().default(90).describe('Timeout in seconds (default: 90, max: 300)'),
    workingDirectory: z.string().optional().describe('Working directory for script execution'),
    key: z.string().optional().describe('Authentication key (required if server has authentication enabled)'),
    confirmed: z.boolean().optional().describe('Explicit confirmation for medium-risk scripts'),
    override: z.boolean().optional().describe('Security override for authorized administrators'),
});

/** PowerShell file execution schema */
const PowerShellFileSchema = z.object({
    filePath: z.string().min(1).describe('Path to PowerShell script file to execute'),
    parameters: z.record(z.string()).optional().describe('Parameters to pass to the script'),
    timeoutSeconds: z.number().int().positive().max(300).optional().default(90).describe('Timeout in seconds (default: 90, max: 300)'),
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
    topic: z.string().optional().describe('Specific help topic: security, monitoring, authentication, examples, capabilities, or ai-agents'),
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
                    tools: {},
                },
            }
        );
        
        // Set server instance for logging
        setMCPServer(this.server);
        
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
            console.error(`≡ƒöÆ AUTHENTICATION: Enabled (Enterprise Mode)`);
            console.error(`≡ƒöæ Key Length: ${this.authKey.length} characters`);
            console.error(`≡ƒöæ Key Preview: ${this.authKey.substring(0, 3)}${'*'.repeat(Math.max(0, this.authKey.length - 3))}`);
            auditLog('INFO', 'AUTH_ENABLED', 'Enterprise MCP Server started with key authentication', {
                keyLength: this.authKey.length,
                keyPreview: this.authKey.substring(0, 3) + '***',
                authMethod: 'key-based',
                mode: 'enterprise'
            });
        } else {
            console.error(`ΓÜá∩╕Å  AUTHENTICATION: Disabled (Development Mode)`);
            console.error(`≡ƒÜ¿ WARNING: Any MCP client can execute PowerShell commands!`);
            auditLog('WARNING', 'AUTH_DISABLED', 'Enterprise MCP Server started without authentication - development mode only', {
                securityLevel: 'none',
                /**
                 * DEPRECATED ADAPTER: vscode-server-enterprise.ts
                 * Unified implementation is in server.ts. This file will be removed later.
                 */
                import { EnterprisePowerShellMCPServer } from './server.js';
                import { auditLog } from './logging/audit.js';

                export { EnterprisePowerShellMCPServer } from './server.js';

                async function main(){
                    const authKey = process.env.MCP_AUTH_KEY;
                    const server = new EnterprisePowerShellMCPServer(authKey);
                    await server.start();
                }

                if (import.meta.url === `file://${process.argv[1]}` || /vscode-server-enterprise\.js$/i.test(process.argv[1]||'')) {
                    main().catch(err => {
                        console.error('[deprecated-entry] fatal startup error', err);
                        auditLog('ERROR','SERVER_FATAL_DEPRECATED','startup failed',{ error: err instanceof Error ? err.message : String(err) });
                        process.exit(1);
                    });
                }

                // End of adapter file.
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
        // ≡ƒÜ½ BLOCKED PATTERNS - These commands are completely blocked
        
        // Registry modifications
        for (const pattern of REGISTRY_MODIFICATION_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN', 
                    reason: `Registry modification blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'REGISTRY_MODIFICATION',
                    patterns: [pattern],
                    recommendations: ['Use read-only registry operations', 'Request administrator approval for modifications']
                };
            }
        }
        
        // System file modifications
        for (const pattern of SYSTEM_FILE_PATTERNS) {
            if (command.includes(pattern) || command.includes(pattern.replace(/\\\\/g, '/'))) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Windows system file modification blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'SYSTEM_FILE_MODIFICATION',
                    patterns: [pattern],
                    recommendations: ['Use temporary directories', 'Work with user-accessible paths only']
                };
            }
        }
        
        // Root drive operations
        for (const pattern of ROOT_DELETION_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Root drive operation blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'ROOT_DRIVE_DELETION',
                    patterns: [pattern],
                    recommendations: ['Use -WhatIf for testing', 'Work with non-system drives']
                };
            }
        }
        
        // Remote modifications
        for (const pattern of REMOTE_MODIFICATION_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Remote machine modification blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'REMOTE_MODIFICATION',
                    patterns: [pattern],
                    recommendations: ['Use localhost only', 'Request remote access approval']
                };
            }
        }
        
        // ≡ƒö┤ CRITICAL THREATS - Security exploits and malware patterns
        for (const pattern of CRITICAL_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'CRITICAL',
                    risk: 'EXTREME',
                    reason: `Critical security threat detected: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'SECURITY_THREAT',
                    patterns: [pattern],
                    recommendations: ['Review command for malicious intent', 'Use safe alternatives']
                };
            }
        }
        
        // ≡ƒƒú DANGEROUS - System-level modifications
        for (const dangerousCmd of DANGEROUS_COMMANDS) {
            if (new RegExp(dangerousCmd, 'i').test(command)) {
                return {
                    level: 'DANGEROUS',
                    risk: 'HIGH',
                    reason: `Dangerous system operation: ${dangerousCmd}`,
                    color: 'MAGENTA',
                    blocked: true,
                    category: 'SYSTEM_MODIFICATION',
                    patterns: [dangerousCmd],
                    recommendations: ['Use -WhatIf for testing', 'Request administrator approval']
                };
            }
        }
        
        // Additional hardcoded dangerous patterns
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
        
        // ≡ƒƒí RISKY - Operations requiring confirmation
        for (const pattern of RISKY_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'RISKY',
                    risk: 'MEDIUM',
                    reason: `File/service modification operation: ${pattern}`,
                    color: 'YELLOW',
                    blocked: false,
                    requiresPrompt: true,
                    category: 'FILE_OPERATION',
                    patterns: [pattern],
                    recommendations: ['Add confirmed: true to proceed', 'Use -WhatIf for testing']
                };
            }
        }
        
        // ≡ƒƒó SAFE - Explicitly safe operations
        for (const pattern of SAFE_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'SAFE',
                    risk: 'LOW',
                    reason: `Safe read-only operation: ${pattern}`,
                    color: 'GREEN',
                    blocked: false,
                    category: 'INFORMATION_GATHERING',
                    patterns: [pattern],
                    recommendations: ['Command is safe to execute']
                };
            }
        }
        
        // ≡ƒö╡ UNKNOWN - Default for unclassified commands with threat tracking
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
        timeoutMs: number = 90000,
        workingDirectory?: string
    ): Promise<PowerShellExecutionResult> {
        const startTime = Date.now();
        let childProcess: ChildProcess | null = null;
        
        try {
            const options: SpawnOptionsWithoutStdio = {
                shell: false,
                ...(workingDirectory && { cwd: workingDirectory })
            };
            
            // Prefer pwsh.exe (PowerShell Core) if present; fallback to Windows PowerShell
            let shellExe: string;
            if(ENTERPRISE_CONFIG?.powershell?.executable){
                shellExe = ENTERPRISE_CONFIG.powershell.executable;
            } else {
                if(typeof (ENTERPRISE_CONFIG as any)._detectedPwsh === 'undefined'){
                    try {
                        const test = spawn('pwsh.exe',['-NoLogo','-NoProfile','-Command','"$PSVersionTable.PSEdition"'], { windowsHide:true });
                        let out='';
                        test.stdout?.on('data',d=> out+=d.toString());
                        test.on('close',code=>{ (ENTERPRISE_CONFIG as any)._detectedPwsh = (code===0 && /core/i.test(out)); });
                    } catch { (ENTERPRISE_CONFIG as any)._detectedPwsh = false; }
                    (ENTERPRISE_CONFIG as any)._detectedPwsh = (ENTERPRISE_CONFIG as any)._detectedPwsh ?? false;
                }
                shellExe = (ENTERPRISE_CONFIG as any)._detectedPwsh ? 'pwsh.exe':'powershell.exe';
            }
            childProcess = spawn(shellExe, ['-NoProfile', '-NonInteractive', '-Command', command], options);
            
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            
            // Set up timeoutMs
            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                if (childProcess && !childProcess.killed) {
                    childProcess.kill('SIGTERM');
                }
            }, timeoutMs);
            
            // Collect output
            if (childProcess.stdout) {
                childProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
            }
            
            if (childProcess.stderr) {
                childProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
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
            if (timedOut) {
                try { metricsRegistry.incrementTimeout(); } catch {}
            }
            
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
                ...(timedOut ? { error: `Command timed out after ${timeoutMs}ms` } : {})
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
# ≡ƒñû Enterprise PowerShell MCP Server - AI Agent Guide

## ≡ƒÄ» Purpose
This MCP server provides secure, enterprise-grade PowerShell command execution with advanced security classification, comprehensive audit logging, and AI agent optimization.

## ≡ƒöº Available Tools
- **powershell-command**: Execute single PowerShell commands
- **powershell-script**: Execute multi-line PowerShell scripts  
- **powershell-file**: Execute PowerShell script files
- **powershell-syntax-check**: Validate PowerShell syntax without execution
- **help**: Get comprehensive help and guidance
- **ai-agent-test**: Run validation tests for server functionality

## 🛡️ Security Levels
- **SAFE** (≡ƒƒó): Read-only operations, execute freely
- **RISKY** (≡ƒƒí): Requires confirmation (add confirmed: true)
- **DANGEROUS** (≡ƒƒú): Blocked - system modifications
- **CRITICAL** (≡ƒö┤): Blocked - security threats
- **BLOCKED** (≡ƒÜ½): Completely prohibited operations`,

            security: `
# 🛡️ Enterprise Security Framework

## Security Classification System
This server implements a 5-level security classification system:

### ≡ƒƒó SAFE Commands (Execute Freely)
- Get-* commands (Get-Date, Get-Process, Get-Location)
- Show-* commands  
- Test-* commands (read-only)
- Out-* commands (Out-Host, Out-String)
- Write-* commands (Write-Host, Write-Output)
- Format-*, Select-*, Where-Object, Sort-Object

### ≡ƒƒí RISKY Commands (Require Confirmation)
- File operations: Remove-Item, Move-Item, Copy-Item
- Service operations: Start-Service, Restart-Service
- Process management: Stop-Process
- Add 'confirmed: true' to parameter to proceed

### ≡ƒƒú DANGEROUS Commands (Blocked)
- System modifications: Stop-Computer, Restart-Computer
- User management: New-LocalUser, Remove-LocalUser
- Service disabling: Set-Service Disabled
- Event log clearing: Clear-EventLog

### ≡ƒö┤ CRITICAL Threats (Blocked)  
- Hidden execution: powershell -WindowStyle Hidden
- Encoded commands: powershell -EncodedCommand
- Downloads: DownloadString, WebClient
- Binary execution: cmd.exe, wscript.exe

### ≡ƒÜ½ BLOCKED Operations
- Registry modifications (HKLM, HKCU)
- System file operations (C:\\Windows\\System32)
- Root drive operations (Format-Volume C:)
- Remote machine modifications`,

            monitoring: `
# ≡ƒôè Enterprise Monitoring & Audit System

## Comprehensive Logging
- **MCP Standard Logging**: notifications/message for real-time monitoring
- **File-based Audit Trail**: ./logs/powershell-mcp-audit-YYYY-MM-DD.log
- **Process Tracking**: Client PID ΓåÆ Server PID lineage
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
# ≡ƒöÉ Enterprise Authentication System

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
# ≡ƒôÜ AI Agent Usage Examples

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
    "timeoutMs": 30000,
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
# ≡ƒñû AI Agent Integration Guide

## Optimal Usage Patterns
1. **Always check help first**: Use help tool to understand capabilities
2. **Test with ai-agent-test**: Validate server functionality before use
3. **Start with safe commands**: Use Get-* commands for information gathering
4. **Handle confirmations**: Include 'confirmed: true' for risky operations
5. **Monitor security levels**: Review classification in responses

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
\`\`\``
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
                safeExecution: 'NEEDS_REVIEW'
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
                        name: 'powershell-command',
                        description: 'Execute a PowerShell command with enterprise-grade security classification and comprehensive audit logging. Supports timeoutMs control, working directory specification, and security confirmation.',
                        inputSchema: zodToJsonSchema(PowerShellCommandSchema),
                    },
                    {
                        name: 'powershell-script',
                        description: 'Execute a multi-line PowerShell script with full security assessment and audit trail. Ideal for complex operations requiring multiple commands.',
                        inputSchema: zodToJsonSchema(PowerShellScriptSchema),
                    },
                    {
                        name: 'powershell-file',
                        description: 'Execute a PowerShell script file with parameter support and comprehensive security analysis. Supports script files with complex parameter requirements.',
                        inputSchema: zodToJsonSchema(PowerShellFileSchema),
                    },
                    {
                        name: 'powershell-syntax-check',
                        description: 'Validate PowerShell script syntax without execution. Perfect for pre-execution validation and development assistance.',
                        inputSchema: zodToJsonSchema(SyntaxCheckSchema),
                    },
                    {
                        name: 'help',
                        description: 'Get comprehensive help information about Enterprise PowerShell MCP Server capabilities, security policies, usage examples, and AI agent integration guidance.',
                        inputSchema: zodToJsonSchema(HelpSchema),
                    },
                    {
                        name: 'ai-agent-test',
                        description: 'Run comprehensive validation tests to verify MCP server functionality, security enforcement, and demonstrate capabilities for AI agents. Tests all security levels safely.',
                        inputSchema: zodToJsonSchema(AITestSchema),
                    },
                    {
                        name: 'threat-analysis',
                        description: 'Get detailed threat tracking statistics including unknown commands, alias detection, and security threat analysis. Helps identify potential security risks and command patterns.',
                        inputSchema: zodToJsonSchema(z.object({
                            includeDetails: z.boolean().optional().describe('Include detailed threat entries in response'),
                            resetStats: z.boolean().optional().describe('Reset threat tracking statistics after retrieval'),
                            key: z.string().optional().describe('Authentication key (required if server has authentication enabled)')
                        })),
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
            console.error("ΓöÇ".repeat(50));
            console.error(`≡ƒöä REQUEST #${this.commandCount} [${requestId}]`);
            console.error(`≡ƒ¢á∩╕Å  Tool: ${name}`);
            console.error(`ΓÅ░ Time: ${requestInfo.timestamp}`);
            console.error(`≡ƒôè Server Uptime: ${requestInfo.serverUptime}`);
            console.error(`≡ƒöù Client PID: ${clientInfo.parentPid} ΓåÆ Server PID: ${clientInfo.serverPid}`);
            if (args) {
                console.error(`⚠️ Arguments: ${JSON.stringify(args, null, 2)}`);
            }

            auditLog('INFO', 'MCP_REQUEST', `Enterprise tool request: ${name}`, requestInfo);

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
                    console.error(`Γ¥î AUTHENTICATION FAILED for ${name}`);
                    throw new McpError(
                        ErrorCode.InvalidRequest,
                        `Authentication failed. ${this.authKey ? 'Valid authentication key required for enterprise mode.' : 'Server running in development mode.'}`
                    );
                }

                console.error(`Γ£à Enterprise authentication passed for ${name}`);

                // Route to appropriate handler
                switch (name) {
                    case 'powershell-command': {
                        const validatedArgs = PowerShellCommandSchema.parse(args);
                        
                        // Security assessment
                        const securityAssessment = this.classifyCommandSafety(validatedArgs.command);
                        
                        console.error(`🚀 Executing PowerShell Command: ${validatedArgs.command}`);
                        const commandTimeoutSeconds = Math.min(300, (validatedArgs.timeoutSeconds ?? 90));
                        const commandTimeoutMs = commandTimeoutSeconds * 1000;
                        console.error(`⏱️  Timeout: ${commandTimeoutSeconds}s (${commandTimeoutMs}ms)`);
                        console.error(`🛡️  Security Level: ${securityAssessment.level} (${securityAssessment.risk} RISK)`);
                        console.error(`⚠️ Risk Reason: ${securityAssessment.reason}`);
                        console.error(`≡ƒÄ¿ Classification Color: ${securityAssessment.color}`);
                        
                        if (validatedArgs.workingDirectory) {
                            console.error(`≡ƒôü Working Directory: ${validatedArgs.workingDirectory}`);
                        }
                        
                        // Security enforcement
                        if (securityAssessment.blocked) {
                            const blockedError = new McpError(
                                ErrorCode.InvalidRequest,
                                `≡ƒÜ½ COMMAND BLOCKED: ${securityAssessment.reason}`
                            );
                            
                            console.error(`≡ƒÜ½ BLOCKED: ${securityAssessment.category} - ${securityAssessment.reason}`);
                            
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
                            
                            throw blockedError;
                        }
                        
                        // Handle confirmation requirements
                        if (securityAssessment.requiresPrompt && !validatedArgs.confirmed && !validatedArgs.override) {
                            const promptError = new McpError(
                                ErrorCode.InvalidRequest,
                                `ΓÜá∩╕Å CONFIRMATION REQUIRED: ${securityAssessment.reason}. Add 'confirmed: true' to proceed or 'override: true' with proper authorization.`
                            );
                            
                            console.error(`ΓÜá∩╕Å CONFIRMATION REQUIRED for ${securityAssessment.category}`);
                            
                            auditLog('WARNING', 'CONFIRMATION_REQUIRED', 'Command requires user confirmation to proceed', {
                                requestId,
                                command: validatedArgs.command,
                                securityLevel: securityAssessment.level,
                                riskLevel: securityAssessment.risk,
                                reason: securityAssessment.reason,
                                category: securityAssessment.category,
                                confirmationInstructions: 'Add confirmed: true parameter'
                            });
                            
                            throw promptError;
                        }
                        
                        
                        // Legacy timeout alias logic removed in restored version; using timeoutSeconds only.
                        console.error(`🚀 Executing enterprise PowerShell command...`);
                        const result = await this.executePowerShellCommand(
                            validatedArgs.command,
                            commandTimeoutMs,
                            validatedArgs.workingDirectory
                        );
                        
                        result.securityAssessment = securityAssessment;
                        
                        // Enhanced result logging
                        console.error(`Γ£à COMMAND COMPLETED [${requestId}]`);
                        console.error(`≡ƒôè Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
                        if (result.duration_ms) console.error(`⏱️  Duration: ${result.duration_ms}ms`);
                        if (result.exitCode !== undefined) console.error(`≡ƒöó Exit Code: ${result.exitCode}`);
                        console.error("ΓöÇ".repeat(50));
                        
                        // Comprehensive audit logging
                        auditLog('INFO', 'MCP_RESPONSE', `Enterprise tool response: ${name}`, {
                            requestId,
                            toolName: name,
                            success: result.success,
                            exitCode: result.exitCode,
                            outputLength: result.stdout?.length || 0,
                            errorLength: result.stderr?.length || 0,
                            duration_ms: result.duration_ms,
                            securityLevel: securityAssessment.level,
                            riskLevel: securityAssessment.risk,
                            category: securityAssessment.category,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return {
                            content: [{ 
                                type: 'text' as const,
                                text: JSON.stringify(result, null, 2)
                            }] as TextContent[]
                        };
                    }
                    
                    case 'powershell-script': {
                        const validatedArgs = PowerShellScriptSchema.parse(args);
                        
                        // Security assessment for scripts
                        const securityAssessment = this.classifyCommandSafety(validatedArgs.script);
                        
                        console.error(`🚀 Executing PowerShell Script (${validatedArgs.script.length} characters)`);
                        const scriptTimeoutSeconds = Math.min(300, (validatedArgs.timeoutSeconds ?? 90));
                        const scriptTimeoutMs = scriptTimeoutSeconds * 1000;
                        console.error(`⏱️  Timeout: ${scriptTimeoutSeconds}s (${scriptTimeoutMs}ms)`);
                        console.error(`🛡️  Security Level: ${securityAssessment.level} (${securityAssessment.risk} RISK)`);
                        
                        // Security enforcement for scripts
                        if (securityAssessment.blocked) {
                            const blockedError = new McpError(
                                ErrorCode.InvalidRequest,
                                `≡ƒÜ½ SCRIPT BLOCKED: ${securityAssessment.reason}`
                            );
                            
                            console.error(`≡ƒÜ½ BLOCKED: ${securityAssessment.category} - ${securityAssessment.reason}`);
                            
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
                            
                            throw blockedError;
                        }
                        
                        // Handle confirmation for scripts
                        if (securityAssessment.requiresPrompt && !validatedArgs.confirmed && !validatedArgs.override) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                `ΓÜá∩╕Å SCRIPT CONFIRMATION REQUIRED: ${securityAssessment.reason}. Add 'confirmed: true' to proceed.`
                            );
                        }
                        
                        
                        // Legacy timeout alias logic removed in restored version.
                        const result = await this.executePowerShellCommand(
                            validatedArgs.script,
                            scriptTimeoutMs,
                            validatedArgs.workingDirectory
                        );
                        
                        result.securityAssessment = securityAssessment;
                        
                        console.error(`Γ£à SCRIPT COMPLETED [${requestId}]`);
                        console.error(`≡ƒôè Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
                        console.error("ΓöÇ".repeat(50));
                        
                        return {
                            content: [{ 
                                type: 'text' as const,
                                text: JSON.stringify(result, null, 2)
                            }]
                        };
                    }
                    
                    case 'powershell-syntax-check': {
                        const validatedArgs = SyntaxCheckSchema.parse(args);
                        
                        console.error(`≡ƒöì Checking PowerShell Syntax (${validatedArgs.content.length} characters)`);
                        
                        const result = await this.checkPowerShellSyntax(validatedArgs.content);
                        
                        console.error(`Γ£à SYNTAX CHECK COMPLETED [${requestId}]`);
                        console.error(`≡ƒôè Valid: ${result.isValid ? 'YES' : 'NO'}`);
                        if (result.errors.length > 0) {
                            console.error(`Γ¥î Errors: ${result.errors.length}`);
                        }
                        console.error("ΓöÇ".repeat(50));
                        
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
                            }]
                        };
                    }
                    
                    case 'help': {
                        const validatedArgs = HelpSchema.parse(args);
                        
                        console.error(`≡ƒôû Generating Help Documentation`);
                        if (validatedArgs.topic) {
                            console.error(`⚠️ Topic: ${validatedArgs.topic}`);
                        }
                        
                        const helpContent = this.generateHelpForAIAgents(validatedArgs.topic);
                        
                        console.error(`Γ£à HELP GENERATED [${requestId}]`);
                        console.error(`≡ƒôè Content Length: ${helpContent.length} characters`);
                        console.error("ΓöÇ".repeat(50));
                        
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
                            }]
                        };
                    }
                    
                    case 'ai-agent-test': {
                        const validatedArgs = AITestSchema.parse(args);
                        
                        console.error(`≡ƒº¬ Running AI Agent Tests`);
                        console.error(`⚠️ Test Suite: ${validatedArgs.testSuite}`);
                        console.error(`🛡️  Skip Dangerous: ${validatedArgs.skipDangerous}`);
                        
                        const testResults = await this.runAIAgentTests(validatedArgs.testSuite, validatedArgs.skipDangerous);
                        
                        console.error(`Γ£à AI AGENT TESTS COMPLETED [${requestId}]`);
                        console.error(`≡ƒôè Results: ${testResults.passed}/${testResults.totalTests} passed (${testResults.summary.successRate})`);
                        console.error(`🛡️  Security Enforcement: ${testResults.summary.securityEnforcement}`);
                        console.error(`ΓÜí Safe Execution: ${testResults.summary.safeExecution}`);
                        console.error("ΓöÇ".repeat(50));
                        
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
                            }]
                        };
                    }
                    
                    case 'threat-analysis': {
                        const validatedArgs = z.object({
                            includeDetails: z.boolean().optional(),
                            resetStats: z.boolean().optional()
                        }).parse(args);
                        
                        console.error(`≡ƒöì Generating Threat Analysis Report`);
                        console.error(`≡ƒôè Include Details: ${validatedArgs.includeDetails || false}`);
                        console.error(`≡ƒöä Reset Stats: ${validatedArgs.resetStats || false}`);
                        
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
                            console.error(`≡ƒöä Threat tracking statistics have been reset`);
                        }
                        
                        console.error(`Γ£à THREAT ANALYSIS COMPLETED [${requestId}]`);
                        console.error(`ΓÜá∩╕Å  Risk Level: ${analysisReport.assessment.overallRisk}`);
                        console.error(`≡ƒÜ¿ Threat Level: ${analysisReport.assessment.threatLevel}`);
                        console.error(`≡ƒôè Unique Threats: ${threatStats.uniqueThreats}`);
                        console.error(`≡ƒöì Aliases Detected: ${threatStats.aliasesDetected}`);
                        console.error("ΓöÇ".repeat(50));
                        
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
                        console.error(`Γ¥î Unknown tool: ${name}`);
                        auditLog('ERROR', 'UNKNOWN_TOOL', `Unknown tool requested: ${name}`, { requestId });
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            } catch (error) {
                // Enhanced error logging
                console.error(`Γ¥î REQUEST FAILED [${requestId}]`);
                console.error(`≡ƒ¢á∩╕Å  Tool: ${name}`);
                console.error(`≡ƒÆÑ Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
                console.error(`≡ƒô¥ Error Message: ${error instanceof Error ? error.message : String(error)}`);
                console.error("ΓöÇ".repeat(50));
                
                auditLog('ERROR', 'MCP_ERROR', `Enterprise tool execution failed: ${name}`, {
                    requestId,
                    toolName: name,
                    errorType: error instanceof Error ? error.constructor.name : typeof error,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
                
                if (error instanceof z.ZodError) {
                    console.error(`≡ƒöì Validation Error Details: ${JSON.stringify(error.errors, null, 2)}`);
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
        
        console.error(`Γ£à ENTERPRISE MCP SERVER CONNECTED SUCCESSFULLY`);
        console.error(`≡ƒöù Transport: STDIO`);
        console.error(`≡ƒôí Ready for AI agent requests`);
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
        console.error(`≡ƒôà Start Time: ${new Date().toISOString()}`);
        console.error(`≡ƒöó Process ID: ${process.pid}`);
        console.error(`≡ƒôê Node.js Version: ${process.version}`);
        console.error(`≡ƒÅó Server Version: 2.0.0 (Enterprise TypeScript)`);
        console.error(`≡ƒöÉ Authentication: ${authKey ? 'ENTERPRISE MODE (Key Required)' : 'DEVELOPMENT MODE'}`);
        console.error(`🛡️  Security: 5-Level Classification System Active`);
        console.error(`≡ƒôè Audit Logging: Comprehensive Enterprise Trail`);
        console.error("=".repeat(60));
        
        // Start the server
        await server.start();
        
        // Keep the process alive
        process.on('SIGINT', () => {
            console.error('\n≡ƒ¢æ Received SIGINT, shutting down gracefully...');
            auditLog('INFO', 'SERVER_SHUTDOWN', 'Enterprise MCP Server shutdown initiated by SIGINT', {
                uptime: Date.now() - server.startTime.getTime() + 'ms',
                commandsProcessed: server.commandCount
            });
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.error('\n≡ƒ¢æ Received SIGTERM, shutting down gracefully...');
            auditLog('INFO', 'SERVER_SHUTDOWN', 'Enterprise MCP Server shutdown initiated by SIGTERM', {
                uptime: Date.now() - server.startTime.getTime() + 'ms',
                commandsProcessed: server.commandCount
            });
            process.exit(0);
        });
        
        console.error(`ΓÅ│ Server running... Press Ctrl+C to shutdown`);
        
    } catch (error) {
        console.error('≡ƒÆÑ FATAL ERROR starting Enterprise MCP Server:');
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
const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('vscode-server-enterprise.js');

if (isMainModule) {
    main().catch((error) => {
        console.error('≡ƒÆÑ Unhandled error in main:');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}





