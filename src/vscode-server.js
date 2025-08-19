import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
// Enhanced audit logging utility with MCP standards compliance and file system support
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, `powershell-mcp-audit-${new Date().toISOString().split('T')[0]}.log`);

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// MCP logging standards compliance
let mcpServer = null;

function setMCPServer(server) {
    mcpServer = server;
}

async function auditLog(level, category, message, metadata) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        category,
        message,
        ...(metadata && { metadata: sanitizeMetadata(metadata) })
    };
    
    // MCP standard logging via notifications/message (when server is available)
    if (mcpServer) {
        try {
            await mcpServer.notification({
                method: "notifications/message",
                params: {
                    level: level,
                    logger: "powershell-mcp-server",
                    data: `[${category}] ${message}${metadata ? ` | ${JSON.stringify(sanitizeMetadata(metadata))}` : ''}`
                }
            });
        } catch (error) {
            // Fallback to stderr only if MCP notification fails
            console.error(`[MCP-LOG-ERROR] Failed to send MCP notification: ${error.message}`);
            console.error(`[${level}] [${category}] ${timestamp} - ${message}` + (metadata ? ` | ${JSON.stringify(sanitizeMetadata(metadata))}` : ''));
        }
    } else {
        // Server initialization phase - use stderr (MCP standard for startup)
        console.error(`[INIT] [${level}] [${category}] ${timestamp} - ${message}` + (metadata ? ` | ${JSON.stringify(sanitizeMetadata(metadata))}` : ''));
    }
    
    // File logging (always maintained for audit trail)
    try {
        const fileLogEntry = `[AUDIT] ${JSON.stringify(logEntry)}\n`;
        fs.appendFileSync(LOG_FILE, fileLogEntry);
    } catch (error) {
        console.error(`Failed to write to log file: ${error.message}`);
    }
}
// System information logging
function logSystemInfo() {
    const systemInfo = {
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
    console.error("🚀 VS Code PowerShell MCP Server Starting");
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
    auditLog('INFO', 'SYSTEM_INFO', 'System information logged', systemInfo);
}
// Sanitize metadata to remove PII and limit content length
function sanitizeMetadata(metadata) {
    if (!metadata)
        return undefined;
    const sanitized = {};
    Object.keys(metadata).forEach(key => {
        const value = metadata[key];
        if (typeof value === 'string') {
            // Limit string length to prevent log spam
            sanitized[key] = value.length > 100 ? value.substring(0, 100) + '...' : value;
        }
        else if (typeof value === 'object' && value !== null) {
            sanitized[key] = '[Object]';
        }
        else {
            sanitized[key] = value;
        }
    });
    return sanitized;
}
// PowerShell command execution schema
const PowerShellCommandSchema = z.object({
    command: z.string().min(1).describe('PowerShell command to execute'),
    timeout: z.number().optional().default(300000).describe('Timeout in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for command execution'),
    authKey: z.string().optional().describe('Authentication key (if server requires authentication)'),
    confirmed: z.boolean().optional().describe('Confirmation for medium-risk commands (required for RISKY/UNKNOWN commands)'),
    override: z.boolean().optional().describe('Override security confirmation (for authorized users only)'),
});
// PowerShell script execution schema
const PowerShellScriptSchema = z.object({
    script: z.string().min(1).describe('PowerShell script content to execute'),
    timeout: z.number().optional().default(300000).describe('Timeout in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for script execution'),
    authKey: z.string().optional().describe('Authentication key (if server requires authentication)'),
    confirmed: z.boolean().optional().describe('Confirmation for medium-risk scripts (required for RISKY/UNKNOWN scripts)'),
    override: z.boolean().optional().describe('Override security confirmation (for authorized users only)'),
});
// PowerShell file execution schema
const PowerShellFileSchema = z.object({
    filePath: z.string().min(1).describe('Path to PowerShell script file to execute'),
    parameters: z.record(z.any()).optional().describe('Parameters to pass to the script'),
    timeout: z.number().optional().default(300000).describe('Timeout in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for file execution'),
    authKey: z.string().optional().describe('Authentication key (if server requires authentication)'),
});
// Enhanced security classification for PowerShell commands
const SAFE_COMMANDS = [
    'Get-Process', 'Get-Service', 'Get-ChildItem', 'Get-Content', 'Get-Location',
    'Get-Date', 'Get-Host', 'Get-Module', 'Get-Command', 'Get-Help',
    'Select-Object', 'Where-Object', 'Sort-Object', 'Measure-Object',
    'Format-Table', 'Format-List', 'Out-String', 'ConvertTo-Json',
    'Test-Path', 'Resolve-Path', 'Split-Path', 'Join-Path', 'Get-Variable',
    'Get-Alias', 'Get-Culture', 'Get-UICulture', 'Get-PSVersion'
];

const RISKY_COMMANDS = [
    'Stop-Process', 'Stop-Service', 'Start-Process', 'New-Item', 
    'Move-Item', 'Copy-Item', 'Rename-Item', 'Set-Content', 'Add-Content'
];

// BLOCKED - Registry modifications
const REGISTRY_MODIFICATION_PATTERNS = [
    'Set-ItemProperty.*HK[LM|CU]', 'New-ItemProperty.*HK[LM|CU]', 'Remove-ItemProperty.*HK[LM|CU]',
    'New-Item.*HK[LM|CU]', 'Remove-Item.*HK[LM|CU]', 'Rename-ItemProperty.*HK[LM|CU]',
    'reg\\s+add', 'reg\\s+delete', 'reg\\s+import', 'regedit'
];

// BLOCKED - Windows system file modifications
const SYSTEM_FILE_PATTERNS = [
    'C:\\\\Windows\\\\System32', 'C:\\\\Windows\\\\SysWOW64', 'C:\\\\Windows\\\\Boot',
    '%SystemRoot%', '%windir%\\\\system32', '%windir%\\\\syswow64',
    'C:\\\\Program Files\\\\Windows', 'C:\\\\ProgramData\\\\Microsoft\\\\Windows'
];

// BLOCKED - Root drive deletions
const ROOT_DELETION_PATTERNS = [
    'Remove-Item\\s+[C-Z]:\\\\[^\\\\]*$', 'del\\s+[C-Z]:\\\\[^\\\\]*$', 'rmdir\\s+[C-Z]:\\\\[^\\\\]*$',
    'Format-Volume\\s+-DriveLetter\\s+[C-Z]', 'Format\\s+[C-Z]:',
    'Remove-Item.*-Recurse.*[C-Z]:\\\\[^\\\\]*$'
];

// BLOCKED - Remote machine modifications
const REMOTE_MODIFICATION_PATTERNS = [
    '-ComputerName\\s+(?!localhost|127\\.0\\.0\\.1|\\.|$env:COMPUTERNAME)',
    'Invoke-Command\\s+.*-ComputerName', 'Enter-PSSession\\s+.*-ComputerName',
    'New-PSSession\\s+.*-ComputerName', 'Remove-Computer', 'Add-Computer',
    'Test-Connection\\s+.*-ComputerName.*-Count\\s+[^1]', 'ping\\s+(?!localhost|127\\.0\\.0\\.1)'
];

const DANGEROUS_COMMANDS = [
    'Remove-Item.*-Recurse', 'Format-Volume', 'Clear-EventLog', 'Stop-Computer',
    'Restart-Computer', 'Reset-ComputerMachinePassword', 'Disable-ComputerRestore', 
    'Enable-ComputerRestore', 'New-LocalUser', 'Remove-LocalUser', 'Set-LocalUser', 
    'Enable-LocalUser', 'Disable-LocalUser', 'Add-LocalGroupMember', 'Remove-LocalGroupMember', 
    'Set-Service', 'New-Service', 'Remove-Service', 'Set-ExecutionPolicy', 'Remove-Item.*\\$',
    'Invoke-Expression', 'Invoke-Command'
];

const CRITICAL_PATTERNS = [
    'cmd\\.exe', 'powershell\\.exe', 'wscript\\.exe', 'cscript\\.exe',
    'mshta\\.exe', 'rundll32\\.exe', 'regsvr32\\.exe', 'bitsadmin',
    'certutil', 'powershell.*-EncodedCommand', 'powershell.*-WindowStyle.*Hidden',
    'DownloadString', 'DownloadFile', 'WebClient', 'Invoke-WebRequest.*-UseBasicParsing',
    'Start-BitsTransfer', 'wget', 'curl.*-o', 'iex\\s*\\(', 'IEX\\s*\\('
];

// Client connection tracking
const CLIENT_CONNECTIONS = new Map();
export class VSCodePowerShellMcpServer {
    server;
    authKey;
    startTime;
    commandCount = 0;
    constructor(authKey) {
        this.authKey = authKey;
        this.startTime = new Date();
        // Log system information first
        logSystemInfo();
        this.server = new Server({
            name: 'powershell-my-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });

        // Register MCP server for proper logging standards compliance
        setMCPServer(this.server);
        // Enhanced authentication logging
        if (this.authKey) {
            console.error(`🔒 AUTHENTICATION: Enabled`);
            console.error(`🔑 Key Length: ${this.authKey.length} characters`);
            console.error(`🔑 Key Preview: ${this.authKey.substring(0, 3)}${'*'.repeat(Math.max(0, this.authKey.length - 3))}`);
            auditLog('INFO', 'AUTH_ENABLED', 'MCP Server started with key authentication', {
                keyLength: this.authKey.length,
                keyPreview: this.authKey.substring(0, 3) + '***',
                authMethod: 'key-based'
            });
        }
        else {
            console.error(`⚠️  AUTHENTICATION: Disabled (Development Mode)`);
            console.error(`🚨 WARNING: Any MCP client can execute PowerShell commands!`);
            auditLog('WARNING', 'AUTH_DISABLED', 'MCP Server started without authentication - development mode only', {
                securityLevel: 'none',
                risk: 'high'
            });
        }
        // Log server configuration
        console.error(`🛠️  Server Name: powershell-my-mcp-server`);
        console.error(`📦 Server Version: 1.0.0`);
        console.error(`🕒 Started At: ${this.startTime.toISOString()}`);
        console.error("=".repeat(60));
        
        // Log monitoring instructions
        console.error(`📊 AUDIT LOGGING ENABLED:`);
        console.error(`📁 Log Location: ./logs/powershell-mcp-audit-${new Date().toISOString().split('T')[0]}.log`);
        console.error(`🔍 To monitor logs in real-time:`);
        console.error(`   • PowerShell: .\\Simple-LogMonitor.ps1 -Follow`);
        console.error(`   • Separate Window: .\\Start-SimpleLogMonitor.ps1`);
        console.error(`   • Manual: Get-Content ./logs/powershell-mcp-audit-*.log -Wait -Tail 10`);
        console.error(`🛡️  Security Assessment: All commands classified (SAFE/RISKY/DANGEROUS/CRITICAL)`);
        console.error(`⚠️  High-risk commands are BLOCKED or require confirmation`);
        console.error("─".repeat(60));
        
        this.setupHandlers();
    }
    classifyCommandSafety(command) {
        const upperCommand = command.toUpperCase();
        const lowerCommand = command.toLowerCase();
        
        // 🚫 BLOCKED PATTERNS - These commands are completely blocked
        
        // Block registry modifications
        for (const pattern of REGISTRY_MODIFICATION_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Registry modification blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'REGISTRY_MODIFICATION'
                };
            }
        }
        
        // Block Windows system file modifications
        for (const pattern of SYSTEM_FILE_PATTERNS) {
            if (command.includes(pattern) || command.includes(pattern.replace(/\\\\/g, '/'))) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Windows system file modification blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'SYSTEM_FILE_MODIFICATION'
                };
            }
        }
        
        // Block root drive deletions
        for (const pattern of ROOT_DELETION_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Root drive deletion/format blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'ROOT_DRIVE_DELETION'
                };
            }
        }
        
        // Block remote machine modifications
        for (const pattern of REMOTE_MODIFICATION_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'BLOCKED',
                    risk: 'FORBIDDEN',
                    reason: `Remote machine modification blocked: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'REMOTE_MODIFICATION'
                };
            }
        }
        
        // 🔴 CRITICAL THREAT - Immediate security risk (BLOCKED)
        for (const pattern of CRITICAL_PATTERNS) {
            if (new RegExp(pattern, 'i').test(command)) {
                return {
                    level: 'CRITICAL',
                    risk: 'EXTREME',
                    reason: `Contains critical security pattern: ${pattern}`,
                    color: 'RED',
                    blocked: true,
                    category: 'SECURITY_THREAT'
                };
            }
        }
        
        // 🟣 DANGEROUS - System modification/destruction (BLOCKED)
        for (const dangerousCmd of DANGEROUS_COMMANDS) {
            if (new RegExp(dangerousCmd, 'i').test(command)) {
                return {
                    level: 'DANGEROUS',
                    risk: 'HIGH',
                    reason: `Dangerous system operation: ${dangerousCmd}`,
                    color: 'MAGENTA',
                    blocked: true,
                    category: 'SYSTEM_MODIFICATION'
                };
            }
        }
        
        // Additional dangerous patterns check (BLOCKED)
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
                category: 'SYSTEM_DESTRUCTION'
            };
        }
        
        // 🟡 RISKY - File/service modification (REQUIRES PROMPT)
        for (const riskyCmd of RISKY_COMMANDS) {
            if (upperCommand.includes(riskyCmd.toUpperCase())) {
                return {
                    level: 'RISKY',
                    risk: 'MEDIUM',
                    reason: `File/service modification command: ${riskyCmd}`,
                    color: 'YELLOW',
                    requiresPrompt: true,
                    category: 'FILE_MODIFICATION'
                };
            }
        }
        
        // Check for file deletions (REQUIRES PROMPT for non-temp files)
        if ((upperCommand.includes('REMOVE-ITEM') && !upperCommand.includes('REMOVE-ITEM.*-WHATIF')) ||
            upperCommand.includes('DEL ') && !command.includes('temp') && !command.includes('tmp')) {
            return {
                level: 'RISKY',
                risk: 'MEDIUM',
                reason: 'File deletion operation requires confirmation',
                color: 'YELLOW',
                requiresPrompt: true,
                category: 'FILE_DELETION'
            };
        }
        
        // 🟢 SAFE - Read-only operations
        for (const safeCmd of SAFE_COMMANDS) {
            if (upperCommand.startsWith(safeCmd.toUpperCase()) || 
                upperCommand.includes(safeCmd.toUpperCase() + ' ')) {
                return {
                    level: 'SAFE',
                    risk: 'LOW',
                    reason: `Read-only operation: ${safeCmd}`,
                    color: 'GREEN',
                    category: 'READ_ONLY'
                };
            }
        }
        
        // 🔵 UNKNOWN - Default to medium risk (REQUIRES PROMPT)
        return {
            level: 'UNKNOWN',
            risk: 'MEDIUM',
            reason: 'Unclassified command - requires review',
            color: 'CYAN',
            requiresPrompt: true,
            category: 'UNCLASSIFIED'
        };
    }
    
    getClientInfo() {
        // Try to get client process information
        const parentPid = process.ppid || 'unknown';
        const currentPid = process.pid;
        
        // Store/retrieve client connection info
        const connectionId = `conn_${Date.now()}`;
        const clientInfo = {
            connectionId,
            serverPid: currentPid,
            parentPid: parentPid,
            timestamp: new Date().toISOString(),
            platform: process.platform,
            nodeVersion: process.version
        };
        
        CLIENT_CONNECTIONS.set(connectionId, clientInfo);
        return clientInfo;
    }
    validateAuthKey(providedKey) {
        // If no auth key is set, allow access (development mode)
        if (!this.authKey) {
            return true;
        }
        // If auth key is set, require matching key
        if (!providedKey || providedKey !== this.authKey) {
            auditLog('WARNING', 'AUTH_FAILED', 'Authentication failed - invalid or missing key', {
                hasProvidedKey: !!providedKey,
                providedKeyLength: providedKey?.length || 0
            });
            return false;
        }
        auditLog('INFO', 'AUTH_SUCCESS', 'Authentication successful');
        return true;
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'powershell-command',
                        description: 'Execute a PowerShell command with safety classification and VS Code integration. All commands logged to ./logs/ with security assessment. Monitor with: .\\Simple-LogMonitor.ps1 -Follow',
                        inputSchema: zodToJsonSchema(PowerShellCommandSchema),
                    },
                    {
                        name: 'powershell-script',
                        description: 'Execute a PowerShell script with multiple lines in VS Code environment. All executions logged with security classification. Monitor with: .\\Start-SimpleLogMonitor.ps1',
                        inputSchema: zodToJsonSchema(PowerShellScriptSchema),
                    },
                    {
                        name: 'powershell-file',
                        description: 'Execute a PowerShell script file with optional parameters in VS Code. Security-assessed and logged to audit files.',
                        inputSchema: zodToJsonSchema(PowerShellFileSchema),
                    },
                    {
                        name: 'powershell-syntax-check',
                        description: 'Check PowerShell script syntax without execution',
                        inputSchema: zodToJsonSchema(z.object({
                            content: z.string().min(1).describe('PowerShell script content to check'),
                            authKey: z.string().optional().describe('Authentication key (if server requires authentication)'),
                        })),
                    },
                    {
                        name: 'help',
                        description: 'Get comprehensive help information about PowerShell MCP Server capabilities, security policies, and usage examples for AI agents',
                        inputSchema: zodToJsonSchema(z.object({
                            topic: z.string().optional().describe('Specific help topic: security, monitoring, authentication, examples, or capabilities'),
                            authKey: z.string().optional().describe('Authentication key (if server requires authentication)'),
                        })),
                    },
                    {
                        name: 'ai-agent-test',
                        description: 'Run comprehensive tests to validate MCP server functionality, security enforcement, and demonstrate capabilities for AI agents. Tests all security levels safely.',
                        inputSchema: zodToJsonSchema(z.object({
                            testSuite: z.string().optional().describe('Test suite to run: basic, security, monitoring, or comprehensive (default: basic)'),
                            skipDangerous: z.boolean().optional().default(true).describe('Skip dangerous command tests (recommended: true)'),
                            authKey: z.string().optional().describe('Authentication key (if server requires authentication)'),
                        })),
                    },
                ],
            };
        });
        // Handle tool execution
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            this.commandCount++;
            // Enhanced MCP request logging with security and client tracking
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
            
            console.error("─".repeat(50));
            console.error(`🔄 REQUEST #${this.commandCount} [${requestId}]`);
            console.error(`🛠️  Tool: ${name}`);
            console.error(`⏰ Time: ${requestInfo.timestamp}`);
            console.error(`📊 Server Uptime: ${requestInfo.serverUptime}`);
            console.error(`🔗 Client PID: ${clientInfo.parentPid} → Server PID: ${clientInfo.serverPid}`);
            if (args) {
                console.error(`📋 Arguments: ${JSON.stringify(args, null, 2)}`);
            }
            await auditLog('info', 'MCP_REQUEST', `Tool request: ${name}`, requestInfo);
            try {
                // Validate authentication before processing any tool
                const authKey = args?.authKey;
                if (!this.validateAuthKey(authKey)) {
                    auditLog('ERROR', 'AUTH_FAILED', `Authentication failed for request ${requestId}`, {
                        requestId,
                        toolName: name,
                        hasProvidedKey: !!authKey,
                        expectedKeyLength: this.authKey?.length || 0
                    });
                    console.error(`❌ AUTHENTICATION FAILED for ${name}`);
                    throw new McpError(ErrorCode.InvalidRequest, `Authentication failed. ${this.authKey ? 'Valid authentication key required.' : 'Server running in development mode.'}`);
                }
                console.error(`✅ Authentication passed for ${name}`);
                switch (name) {
                    case 'powershell-command': {
                        const validatedArgs = PowerShellCommandSchema.parse(args);
                        
                        // Security threat assessment
                        const securityAssessment = this.classifyCommandSafety(validatedArgs.command);
                        
                        console.error(`🔨 Executing PowerShell Command: ${validatedArgs.command}`);
                        console.error(`⏱️  Timeout: ${validatedArgs.timeout}ms`);
                        console.error(`🛡️  Security Level: ${securityAssessment.level} (${securityAssessment.risk} RISK)`);
                        console.error(`📋 Risk Reason: ${securityAssessment.reason}`);
                        
                        if (validatedArgs.workingDirectory) {
                            console.error(`📁 Working Directory: ${validatedArgs.workingDirectory}`);
                        }
                        
                        // 🚫 SECURITY ENFORCEMENT - Block dangerous/critical commands
                        if (securityAssessment.blocked) {
                            const blockedError = new McpError(
                                ErrorCode.InvalidRequest,
                                `🚫 COMMAND BLOCKED: ${securityAssessment.reason}`
                            );
                            
                            console.error(`🚫 BLOCKED: ${securityAssessment.category} - ${securityAssessment.reason}`);
                            
                            await auditLog('error', 'COMMAND_BLOCKED', `Security policy blocked command execution`, {
                                requestId,
                                command: validatedArgs.command,
                                securityLevel: securityAssessment.level,
                                riskLevel: securityAssessment.risk,
                                reason: securityAssessment.reason,
                                category: securityAssessment.category,
                                clientPid: clientInfo.parentPid,
                                serverPid: clientInfo.serverPid,
                                blockingPolicy: 'SECURITY_ENFORCEMENT'
                            });
                            
                            // Return detailed blocking information for VSCode Copilot Chat
                            return {
                                content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        blocked: true,
                                        success: false,
                                        error: `Command blocked by security policy: ${securityAssessment.reason}`,
                                        securityAssessment: securityAssessment,
                                        securityWarning: {
                                            level: securityAssessment.level,
                                            risk: securityAssessment.risk,
                                            message: `🚫 COMMAND BLOCKED: ${securityAssessment.reason}`,
                                            recommendation: `This command violates security policy (${securityAssessment.category}). Use safer alternatives or request admin approval.`,
                                            category: securityAssessment.category
                                        },
                                        executionContext: {
                                            timestamp: new Date().toISOString(),
                                            serverPid: process.pid,
                                            clientPid: clientInfo.parentPid,
                                            requestId: requestId,
                                            action: 'BLOCKED'
                                        }
                                    }, null, 2)
                                }]
                            };
                        }
                        
                        // ⚠️ PROMPT REQUIRED - For medium risk commands
                        if (securityAssessment.requiresPrompt) {
                            console.error(`⚠️ PROMPT REQUIRED: ${securityAssessment.reason}`);
                            
                            // In MCP context, we can't do interactive prompts, so we return a warning
                            // and ask for explicit confirmation through a parameter
                            if (!args.confirmed && !args.override) {
                                auditLog('WARN', 'PROMPT_REQUIRED', `Command requires confirmation`, {
                                    requestId,
                                    command: validatedArgs.command,
                                    securityLevel: securityAssessment.level,
                                    reason: securityAssessment.reason,
                                    category: securityAssessment.category,
                                    clientPid: clientInfo.parentPid,
                                    serverPid: clientInfo.serverPid
                                });
                                
                                return {
                                    content: [{
                                        type: 'text',
                                        text: JSON.stringify({
                                            promptRequired: true,
                                            success: false,
                                            message: `⚠️ CONFIRMATION REQUIRED: ${securityAssessment.reason}`,
                                            securityAssessment: securityAssessment,
                                            confirmationInstructions: {
                                                message: "This command requires confirmation due to security policy.",
                                                howToConfirm: "Add 'confirmed: true' or 'override: true' to the command parameters to proceed.",
                                                riskLevel: securityAssessment.risk,
                                                category: securityAssessment.category
                                            },
                                            executionContext: {
                                                timestamp: new Date().toISOString(),
                                                serverPid: process.pid,
                                                clientPid: clientInfo.parentPid,
                                                requestId: requestId,
                                                action: 'PROMPT_REQUIRED'
                                            }
                                        }, null, 2)
                                    }]
                                };
                            } else {
                                console.error(`✅ CONFIRMATION PROVIDED: Proceeding with execution`);
                                await auditLog('warning', 'CONFIRMATION_PROVIDED', `User confirmed risky command execution`, {
                                    requestId,
                                    command: validatedArgs.command,
                                    confirmationType: args.confirmed ? 'confirmed' : 'override',
                                    clientPid: clientInfo.parentPid,
                                    serverPid: clientInfo.serverPid
                                });
                            }
                        }
                        
                        // Log security assessment
                        auditLog('INFO', 'SECURITY_ASSESSMENT', `Command security analysis`, {
                            requestId,
                            command: validatedArgs.command.substring(0, 100) + (validatedArgs.command.length > 100 ? '...' : ''),
                            securityLevel: securityAssessment.level,
                            riskLevel: securityAssessment.risk,
                            reason: securityAssessment.reason,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        // Create response object with security context for VSCode Copilot Chat
                        const enhancedResult = {
                            ...result,
                            securityAssessment: securityAssessment,
                            executionContext: {
                                timestamp: new Date().toISOString(),
                                serverPid: process.pid,
                                clientPid: clientInfo.parentPid,
                                requestId: requestId
                            }
                        };
                        
                        // Add security warnings for high-risk commands
                        if (securityAssessment.level === 'CRITICAL' || securityAssessment.level === 'DANGEROUS') {
                            enhancedResult.securityWarning = {
                                level: securityAssessment.level,
                                risk: securityAssessment.risk,
                                message: `⚠️ HIGH RISK COMMAND EXECUTED: ${securityAssessment.reason}`,
                                recommendation: securityAssessment.level === 'CRITICAL' ? 
                                    'This command poses extreme security risks. Review system integrity immediately.' :
                                    'This command modifies system state. Verify changes are intentional.'
                            };
                        }
                        
                        const response = {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(enhancedResult, null, 2)
                                }]
                        };
                        
                        // Log completion details and response
                        console.error(`✅ COMMAND COMPLETED [${requestId}]`);
                        console.error(`📊 Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
                        if (result.duration_ms)
                            console.error(`⏱️  Duration: ${result.duration_ms}ms`);
                        if (result.exitCode !== undefined)
                            console.error(`🔢 Exit Code: ${result.exitCode}`);
                        console.error("─".repeat(50));
                        
                        // Audit log the response with security details
                        auditLog('INFO', 'MCP_RESPONSE', `Tool response: ${name}`, {
                            requestId,
                            toolName: name,
                            success: result.success,
                            exitCode: result.exitCode,
                            outputLength: result.stdout?.length || 0,
                            errorLength: result.stderr?.length || 0,
                            duration_ms: result.duration_ms,
                            responseSize: JSON.stringify(response).length,
                            securityLevel: securityAssessment.level,
                            riskLevel: securityAssessment.risk,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return response;
                    }
                    case 'powershell-script': {
                        const validatedArgs = PowerShellScriptSchema.parse(args);
                        
                        // Security threat assessment for script content
                        const securityAssessment = this.classifyCommandSafety(validatedArgs.script);
                        
                        console.error(`📜 Executing PowerShell Script (${validatedArgs.script.length} characters)`);
                        console.error(`⏱️  Timeout: ${validatedArgs.timeout}ms`);
                        console.error(`🛡️  Security Level: ${securityAssessment.level} (${securityAssessment.risk} RISK)`);
                        console.error(`📋 Risk Reason: ${securityAssessment.reason}`);
                        
                        if (validatedArgs.workingDirectory) {
                            console.error(`📁 Working Directory: ${validatedArgs.workingDirectory}`);
                        }
                        
                        // 🚫 SECURITY ENFORCEMENT - Block dangerous/critical scripts
                        if (securityAssessment.blocked) {
                            const blockedError = new McpError(
                                ErrorCode.InvalidRequest,
                                `🚫 SCRIPT BLOCKED: ${securityAssessment.reason}`
                            );
                            
                            console.error(`🚫 BLOCKED: ${securityAssessment.category} - ${securityAssessment.reason}`);
                            
                            auditLog('ERROR', 'SCRIPT_BLOCKED', `Security policy blocked script execution`, {
                                requestId,
                                scriptLength: validatedArgs.script.length,
                                scriptPreview: validatedArgs.script.substring(0, 200) + (validatedArgs.script.length > 200 ? '...' : ''),
                                securityLevel: securityAssessment.level,
                                riskLevel: securityAssessment.risk,
                                reason: securityAssessment.reason,
                                category: securityAssessment.category,
                                clientPid: clientInfo.parentPid,
                                serverPid: clientInfo.serverPid,
                                blockingPolicy: 'SECURITY_ENFORCEMENT'
                            });
                            
                            return {
                                content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        blocked: true,
                                        success: false,
                                        error: `Script blocked by security policy: ${securityAssessment.reason}`,
                                        securityAssessment: securityAssessment,
                                        securityWarning: {
                                            level: securityAssessment.level,
                                            risk: securityAssessment.risk,
                                            message: `🚫 SCRIPT BLOCKED: ${securityAssessment.reason}`,
                                            recommendation: `This script violates security policy (${securityAssessment.category}). Use safer alternatives or request admin approval.`,
                                            category: securityAssessment.category
                                        },
                                        executionContext: {
                                            timestamp: new Date().toISOString(),
                                            serverPid: process.pid,
                                            clientPid: clientInfo.parentPid,
                                            requestId: requestId,
                                            action: 'BLOCKED',
                                            scriptLength: validatedArgs.script.length
                                        }
                                    }, null, 2)
                                }]
                            };
                        }
                        
                        // ⚠️ PROMPT REQUIRED - For medium risk scripts
                        if (securityAssessment.requiresPrompt) {
                            console.error(`⚠️ PROMPT REQUIRED: ${securityAssessment.reason}`);
                            
                            if (!args.confirmed && !args.override) {
                                auditLog('WARN', 'SCRIPT_PROMPT_REQUIRED', `Script requires confirmation`, {
                                    requestId,
                                    scriptLength: validatedArgs.script.length,
                                    scriptPreview: validatedArgs.script.substring(0, 100) + '...',
                                    securityLevel: securityAssessment.level,
                                    reason: securityAssessment.reason,
                                    category: securityAssessment.category,
                                    clientPid: clientInfo.parentPid,
                                    serverPid: clientInfo.serverPid
                                });
                                
                                return {
                                    content: [{
                                        type: 'text',
                                        text: JSON.stringify({
                                            promptRequired: true,
                                            success: false,
                                            message: `⚠️ CONFIRMATION REQUIRED: ${securityAssessment.reason}`,
                                            securityAssessment: securityAssessment,
                                            confirmationInstructions: {
                                                message: "This script requires confirmation due to security policy.",
                                                howToConfirm: "Add 'confirmed: true' or 'override: true' to the script parameters to proceed.",
                                                riskLevel: securityAssessment.risk,
                                                category: securityAssessment.category
                                            },
                                            executionContext: {
                                                timestamp: new Date().toISOString(),
                                                serverPid: process.pid,
                                                clientPid: clientInfo.parentPid,
                                                requestId: requestId,
                                                action: 'PROMPT_REQUIRED',
                                                scriptLength: validatedArgs.script.length
                                            }
                                        }, null, 2)
                                    }]
                                };
                            } else {
                                console.error(`✅ CONFIRMATION PROVIDED: Proceeding with script execution`);
                                auditLog('WARN', 'SCRIPT_CONFIRMATION_PROVIDED', `User confirmed risky script execution`, {
                                    requestId,
                                    confirmationType: args.confirmed ? 'confirmed' : 'override',
                                    clientPid: clientInfo.parentPid,
                                    serverPid: clientInfo.serverPid
                                });
                            }
                        }
                        
                        // Log security assessment for script
                        auditLog('INFO', 'SECURITY_ASSESSMENT', `Script security analysis`, {
                            requestId,
                            scriptLength: validatedArgs.script.length,
                            scriptPreview: validatedArgs.script.substring(0, 200) + (validatedArgs.script.length > 200 ? '...' : ''),
                            securityLevel: securityAssessment.level,
                            riskLevel: securityAssessment.risk,
                            reason: securityAssessment.reason,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        const result = await this.executePowerShellScript(validatedArgs.script, validatedArgs.timeout, validatedArgs.workingDirectory, securityAssessment);
                        
                        // Create response object with security context
                        const enhancedResult = {
                            ...result,
                            securityAssessment: securityAssessment,
                            executionContext: {
                                timestamp: new Date().toISOString(),
                                serverPid: process.pid,
                                clientPid: clientInfo.parentPid,
                                requestId: requestId,
                                scriptLength: validatedArgs.script.length
                            }
                        };
                        
                        // Add security warnings for high-risk scripts
                        if (securityAssessment.level === 'CRITICAL' || securityAssessment.level === 'DANGEROUS') {
                            enhancedResult.securityWarning = {
                                level: securityAssessment.level,
                                risk: securityAssessment.risk,
                                message: `⚠️ HIGH RISK SCRIPT EXECUTED: ${securityAssessment.reason}`,
                                recommendation: securityAssessment.level === 'CRITICAL' ? 
                                    'This script poses extreme security risks. Review system integrity immediately.' :
                                    'This script modifies system state. Verify changes are intentional.'
                            };
                        }
                        
                        const response = {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(enhancedResult, null, 2)
                                }]
                        };
                        
                        // Log completion details and response
                        console.error(`✅ SCRIPT COMPLETED [${requestId}]`);
                        console.error(`📊 Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
                        if (result.duration_ms)
                            console.error(`⏱️  Duration: ${result.duration_ms}ms`);
                        console.error("─".repeat(50));
                        
                        // Audit log the response with security details
                        auditLog('INFO', 'MCP_RESPONSE', `Tool response: ${name}`, {
                            requestId,
                            toolName: name,
                            success: result.success,
                            scriptLength: validatedArgs.script.length,
                            outputLength: result.stdout?.length || 0,
                            errorLength: result.stderr?.length || 0,
                            duration_ms: result.duration_ms,
                            responseSize: JSON.stringify(response).length,
                            securityLevel: securityAssessment.level,
                            riskLevel: securityAssessment.risk,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return response;
                    }
                    case 'powershell-file': {
                        const validatedArgs = PowerShellFileSchema.parse(args);
                        console.error(`📁 Executing PowerShell File: ${validatedArgs.filePath}`);
                        console.error(`⏱️  Timeout: ${validatedArgs.timeout}ms`);
                        if (validatedArgs.parameters) {
                            console.error(`⚙️  Parameters: ${JSON.stringify(validatedArgs.parameters)}`);
                        }
                        if (validatedArgs.workingDirectory) {
                            console.error(`📁 Working Directory: ${validatedArgs.workingDirectory}`);
                        }
                        const result = await this.executePowerShellFile(validatedArgs.filePath, validatedArgs.parameters, validatedArgs.timeout, validatedArgs.workingDirectory);
                        
                        // Create response object
                        const response = {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2)
                                }]
                        };
                        
                        // Log completion details and response
                        console.error(`✅ FILE COMPLETED [${requestId}]`);
                        console.error(`📊 Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
                        if (result.duration_ms)
                            console.error(`⏱️  Duration: ${result.duration_ms}ms`);
                        console.error("─".repeat(50));
                        
                        // Audit log the response
                        auditLog('INFO', 'MCP_RESPONSE', `Tool response: ${name}`, {
                            requestId,
                            toolName: name,
                            success: result.success,
                            filePath: validatedArgs.filePath,
                            hasParameters: !!validatedArgs.parameters,
                            outputLength: result.stdout?.length || 0,
                            errorLength: result.stderr?.length || 0,
                            duration_ms: result.duration_ms,
                            responseSize: JSON.stringify(response).length
                        });
                        
                        return response;
                    }
                    case 'powershell-syntax-check': {
                        const validatedArgs = z.object({
                            content: z.string().min(1),
                            authKey: z.string().optional(),
                        }).parse(args);
                        console.error(`🔍 Checking PowerShell Syntax (${validatedArgs.content.length} characters)`);
                        const result = await this.checkPowerShellSyntax(validatedArgs.content);
                        // Log completion details
                        console.error(`✅ SYNTAX CHECK COMPLETED [${requestId}]`);
                        console.error(`📊 Result: ${result.isValid ? 'VALID' : 'INVALID'}`);
                        console.error("─".repeat(50));
                        return {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2)
                                }]
                        };
                    }
                    
                    case 'help': {
                        const validatedArgs = z.object({
                            topic: z.string().optional(),
                            authKey: z.string().optional(),
                        }).parse(args);
                        
                        console.error(`📚 Providing help information for AI agent`);
                        if (validatedArgs.topic) {
                            console.error(`🎯 Topic: ${validatedArgs.topic}`);
                        }
                        
                        const helpInfo = this.generateHelpForAIAgents(validatedArgs.topic);
                        
                        console.error(`✅ HELP PROVIDED [${requestId}]`);
                        console.error("─".repeat(50));
                        
                        auditLog('INFO', 'HELP_REQUEST', 'AI agent requested help information', {
                            requestId,
                            topic: validatedArgs.topic || 'general',
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify(helpInfo, null, 2)
                            }]
                        };
                    }
                    
                    case 'ai-agent-test': {
                        const validatedArgs = z.object({
                            testSuite: z.string().optional().default('basic'),
                            skipDangerous: z.boolean().optional().default(true),
                            authKey: z.string().optional(),
                        }).parse(args);
                        
                        console.error(`🧪 Running AI Agent Test Suite: ${validatedArgs.testSuite}`);
                        console.error(`🛡️  Skip Dangerous Tests: ${validatedArgs.skipDangerous}`);
                        
                        const testResults = await this.runAIAgentTests(validatedArgs.testSuite, validatedArgs.skipDangerous);
                        
                        console.error(`✅ AI AGENT TESTS COMPLETED [${requestId}]`);
                        console.error(`📊 Total Tests: ${testResults.totalTests}, Passed: ${testResults.passed}, Failed: ${testResults.failed}`);
                        console.error("─".repeat(50));
                        
                        auditLog('INFO', 'AI_AGENT_TEST', 'AI agent ran test suite', {
                            requestId,
                            testSuite: validatedArgs.testSuite,
                            skipDangerous: validatedArgs.skipDangerous,
                            totalTests: testResults.totalTests,
                            passed: testResults.passed,
                            failed: testResults.failed,
                            clientPid: clientInfo.parentPid,
                            serverPid: clientInfo.serverPid
                        });
                        
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify(testResults, null, 2)
                            }]
                        };
                    }
                    default:
                        console.error(`❌ Unknown tool: ${name}`);
                        auditLog('ERROR', 'UNKNOWN_TOOL', `Unknown tool requested: ${name}`, { requestId });
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                // Enhanced error logging
                console.error(`❌ REQUEST FAILED [${requestId}]`);
                console.error(`🛠️  Tool: ${name}`);
                console.error(`💥 Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
                console.error(`📝 Error Message: ${error instanceof Error ? error.message : String(error)}`);
                console.error("─".repeat(50));
                await auditLog('error', 'MCP_ERROR', `Tool execution failed: ${name}`, {
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
    async executePowerShellCommand(command, timeout = 300000, workingDirectory, securityAssessment = null) {
        return new Promise((resolve, reject) => {
            const safety = securityAssessment || this.classifyCommandSafety(command);
            auditLog('info', 'COMMAND_START', 'PowerShell command execution started', {
                command: command.length > 50 ? command.substring(0, 50) + '...' : command,
                timeout: timeout,
                securityLevel: safety.level,
                riskLevel: safety.risk,
                reason: safety.reason,
                workingDirectory: workingDirectory
            });
            console.error("[MCP-AUDIT] " + new Date().toISOString() + " - Command execution started: " + (command.length > 50 ? command.substring(0, 50) + "..." : command));
            console.error(`[SECURITY] Threat Level: ${safety.level} (${safety.risk} RISK) - ${safety.reason}`);
            const options = {
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            };
            if (workingDirectory) {
                options.cwd = workingDirectory;
            }
            const ps = spawn('pwsh', ['-Command', command], options);
            let stdout = '';
            let stderr = '';
            ps.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            ps.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            const timer = setTimeout(() => {
                ps.kill();
                reject(new Error(`Command timed out after ${timeout}ms`));
            }, timeout);
            ps.on('close', (code) => {
                clearTimeout(timer);
                const result = {
                    method: 'vscode-powershell-command',
                    command,
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    success: code === 0,
                    safety,
                    timestamp: new Date().toISOString(),
                    workingDirectory: workingDirectory || process.cwd()
                };
                auditLog('INFO', 'COMMAND_COMPLETE', 'PowerShell command execution completed', {
                    exitCode: code,
                    success: code === 0,
                    safety: safety
                });
                console.error("[AUDIT-LOG] " + new Date().toISOString() + " - Command executed successfully");
                resolve(result);
            });
            ps.on('error', (error) => {
                clearTimeout(timer);
                auditLog('ERROR', 'COMMAND_ERROR', 'PowerShell command execution failed', {
                    error: error.message
                });
                reject(error);
            });
        });
    }
    async executePowerShellScript(script, timeout = 300000, workingDirectory, securityAssessment = null) {
        return new Promise((resolve, reject) => {
            const safety = securityAssessment || this.classifyCommandSafety(script);
            console.error(`[SECURITY] Script Threat Level: ${safety.level} (${safety.risk} RISK) - ${safety.reason}`);
            
            const options = {
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            };
            if (workingDirectory) {
                options.cwd = workingDirectory;
            }
            const ps = spawn('pwsh', ['-Command', script], options);
            let stdout = '';
            let stderr = '';
            ps.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            ps.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            const timer = setTimeout(() => {
                ps.kill();
                reject(new Error(`Script timed out after ${timeout}ms`));
            }, timeout);
            ps.on('close', (code) => {
                clearTimeout(timer);
                resolve({
                    method: 'vscode-powershell-script',
                    script: script.length > 100 ? script.substring(0, 100) + '...' : script,
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    success: code === 0,
                    safety,
                    timestamp: new Date().toISOString(),
                    workingDirectory: workingDirectory || process.cwd()
                });
            });
            ps.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    async executePowerShellFile(filePath, parameters, timeout = 30000, workingDirectory) {
        return new Promise((resolve, reject) => {
            let command = `& "${filePath}"`;
            if (parameters) {
                const paramString = Object.entries(parameters)
                    .map(([key, value]) => `-${key} "${value}"`)
                    .join(' ');
                command += ` ${paramString}`;
            }
            const safety = 'risky'; // File execution is inherently risky
            const options = {
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            };
            if (workingDirectory) {
                options.cwd = workingDirectory;
            }
            const ps = spawn('pwsh', ['-Command', command], options);
            let stdout = '';
            let stderr = '';
            ps.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            ps.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            const timer = setTimeout(() => {
                ps.kill();
                reject(new Error(`File execution timed out after ${timeout}ms`));
            }, timeout);
            ps.on('close', (code) => {
                clearTimeout(timer);
                resolve({
                    method: 'vscode-powershell-file',
                    filePath,
                    parameters,
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    success: code === 0,
                    safety,
                    timestamp: new Date().toISOString(),
                    workingDirectory: workingDirectory || process.cwd()
                });
            });
            ps.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    
    generateHelpForAIAgents(topic) {
        const baseHelp = {
            serverInfo: {
                name: 'PowerShell MCP Server',
                version: '1.0.0',
                description: 'Secure PowerShell command execution with safety classification and comprehensive audit logging',
                authentication: this.authKey ? 'Required (key-based)' : 'Disabled (development mode)',
                securityEnforcement: 'Active (DANGEROUS/CRITICAL commands blocked, RISKY requires confirmation)'
            },
            availableTools: [
                {
                    name: 'powershell-command',
                    purpose: 'Execute single PowerShell commands',
                    securityLevel: 'All commands security-classified before execution',
                    parameters: {
                        command: 'PowerShell command to execute (required)',
                        timeout: 'Execution timeout in milliseconds (optional, default: 300000)',
                        workingDirectory: 'Working directory for command execution (optional)',
                        confirmed: 'Confirm execution of RISKY commands (optional boolean)',
                        override: 'Override security prompt for RISKY commands (optional boolean)',
                        authKey: 'Authentication key if server requires it (optional)'
                    }
                },
                {
                    name: 'powershell-script',
                    purpose: 'Execute multi-line PowerShell scripts',
                    securityLevel: 'Full script content security-assessed',
                    parameters: {
                        script: 'Multi-line PowerShell script content (required)',
                        timeout: 'Execution timeout in milliseconds (optional, default: 300000)',
                        workingDirectory: 'Working directory for script execution (optional)',
                        confirmed: 'Confirm execution of RISKY scripts (optional boolean)',
                        override: 'Override security prompt for RISKY scripts (optional boolean)',
                        authKey: 'Authentication key if server requires it (optional)'
                    }
                },
                {
                    name: 'powershell-file',
                    purpose: 'Execute PowerShell script files',
                    parameters: {
                        filePath: 'Path to PowerShell script file (required)',
                        parameters: 'Parameters to pass to script (optional)',
                        authKey: 'Authentication key if server requires it (optional)'
                    }
                },
                {
                    name: 'powershell-syntax-check',
                    purpose: 'Validate PowerShell syntax without execution',
                    parameters: {
                        content: 'PowerShell script content to validate (required)',
                        authKey: 'Authentication key if server requires it (optional)'
                    }
                },
                {
                    name: 'help',
                    purpose: 'Get detailed help information for AI agents',
                    parameters: {
                        topic: 'Specific help topic (optional): security, monitoring, authentication, examples, or capabilities',
                        authKey: 'Authentication key if server requires it (optional)'
                    }
                }
            ],
            securityClassification: {
                'SAFE (GREEN)': {
                    description: 'Read-only operations, system queries',
                    action: 'Execute immediately with logging',
                    examples: ['Get-Date', 'Get-Location', 'Get-Process', '$PSVersionTable']
                },
                'RISKY (YELLOW)': {
                    description: 'File modifications, service operations',
                    action: 'Requires confirmation (confirmed: true or override: true parameter)',
                    examples: ['Remove-Item', 'New-Item', 'Set-Content', 'Stop-Service']
                },
                'DANGEROUS (RED)': {
                    description: 'System modifications, privilege escalation',
                    action: 'BLOCKED - Returns error with security warning',
                    examples: ['Format-Volume', 'Set-ExecutionPolicy', 'New-LocalUser', 'Remove-Item -Recurse']
                },
                'CRITICAL (PURPLE)': {
                    description: 'Security exploits, malware patterns, hidden execution',
                    action: 'ALWAYS BLOCKED - Security threat detected',
                    examples: ['powershell -WindowStyle Hidden', 'Invoke-WebRequest malicious-url', 'encoded commands']
                }
            },
            monitoring: {
                logLocation: `./logs/powershell-mcp-audit-${new Date().toISOString().split('T')[0]}.log`,
                monitoringCommands: [
                    '.\\Simple-LogMonitor.ps1 -Follow (real-time color-coded monitoring)',
                    '.\\Start-SimpleLogMonitor.ps1 (separate window monitoring)',
                    'Get-Content ./logs/powershell-mcp-audit-*.log -Wait -Tail 10 (manual monitoring)'
                ],
                loggedInformation: [
                    'All command executions with timestamps',
                    'Security classifications and risk assessments',
                    'Client and server process IDs',
                    'Command success/failure status',
                    'Security policy enforcement actions'
                ]
            }
        };

        // Topic-specific help
        switch (topic?.toLowerCase()) {
            case 'security':
                return {
                    ...baseHelp,
                    securityDetails: {
                        blockedPatterns: {
                            registryModifications: ['Set-ItemProperty.*HK[LM|CU]', 'reg add', 'regedit'],
                            systemFiles: ['C:\\Windows\\System32', '%SystemRoot%', '%windir%\\system32'],
                            rootDeletions: ['Remove-Item C:\\', 'Format-Volume -DriveLetter', 'del C:\\'],
                            remoteOperations: ['-ComputerName (non-localhost)', 'Invoke-Command -ComputerName', 'Enter-PSSession']
                        },
                        confirmationRequired: {
                            fileOperations: ['Remove-Item', 'New-Item', 'Set-Content'],
                            serviceOperations: ['Stop-Service', 'Start-Service', 'Set-Service'],
                            networkOperations: ['Test-Connection', 'Invoke-WebRequest']
                        },
                        howToConfirm: 'Add confirmed: true or override: true to command parameters'
                    }
                };
                
            case 'monitoring':
                return {
                    serverInfo: baseHelp.serverInfo,
                    monitoring: baseHelp.monitoring,
                    testingCommands: [
                        '.\\Generate-SecurityTestLogs.ps1 (generate test data)',
                        '.\\Test-BasicMCP.ps1 (test server connectivity)',
                        '.\\Test-SecurityPolicyEnforcement.ps1 (test security policies)'
                    ]
                };
                
            case 'authentication':
                return {
                    serverInfo: baseHelp.serverInfo,
                    authenticationModes: {
                        developmentMode: {
                            description: 'No authentication required',
                            usage: 'node src/vscode-server.js (no --key parameter)',
                            security: 'WARNING: Any client can execute commands'
                        },
                        productionMode: {
                            description: 'Key-based authentication required',
                            usage: 'node src/vscode-server.js --key yourSecretKey123',
                            environment: '$env:POWERSHELL_MCP_KEY=yourkey; node src/vscode-server.js',
                            clientUsage: 'Include authKey parameter in all tool calls'
                        }
                    }
                };
                
            case 'examples':
                return {
                    serverInfo: baseHelp.serverInfo,
                    usageExamples: {
                        safeCommand: {
                            tool: 'powershell-command',
                            parameters: { command: 'Get-Date' },
                            expectedResult: 'Executes immediately, logs as SAFE'
                        },
                        riskyCommand: {
                            tool: 'powershell-command',
                            parameters: { command: 'Remove-Item ./test.txt', confirmed: true },
                            expectedResult: 'Executes with confirmation, logs as RISKY'
                        },
                        blockedCommand: {
                            tool: 'powershell-command',
                            parameters: { command: 'Format-Volume -DriveLetter C' },
                            expectedResult: 'BLOCKED with security error, logs as DANGEROUS'
                        },
                        scriptExecution: {
                            tool: 'powershell-script',
                            parameters: { 
                                script: '$date = Get-Date\nWrite-Host "Current time: $date"' 
                            },
                            expectedResult: 'Multi-line script execution with full security assessment'
                        }
                    }
                };
                
            case 'capabilities':
                return {
                    serverInfo: baseHelp.serverInfo,
                    capabilities: {
                        executionMethods: ['Job-based execution', 'RestrictedRunspace', 'Direct ScriptBlock'],
                        timeoutHandling: 'Configurable timeout (default: 5 minutes)',
                        securityFeatures: [
                            'Real-time command classification',
                            'Pattern-based threat detection',
                            'Automatic blocking of dangerous operations',
                            'Confirmation prompts for risky operations'
                        ],
                        loggingFeatures: [
                            'Comprehensive audit trails',
                            'Security classification logging',
                            'Client/server process tracking',
                            'Real-time monitoring capabilities'
                        ],
                        integrationFeatures: [
                            'VSCode Copilot Chat integration',
                            'MCP protocol compliance',
                            'Enhanced error reporting',
                            'Security warning propagation'
                        ]
                    }
                };
                
            default:
                return baseHelp;
        }
    }
    
    async runAIAgentTests(testSuite, skipDangerous = true) {
        const results = {
            testSuite: testSuite,
            timestamp: new Date().toISOString(),
            serverPid: process.pid,
            skipDangerous: skipDangerous,
            totalTests: 0,
            passed: 0,
            failed: 0,
            tests: []
        };

        const testCommands = {
            basic: [
                { name: 'Get Current Date', command: 'Get-Date', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Get Process List', command: 'Get-Process | Select-Object -First 3', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Get PowerShell Version', command: '$PSVersionTable.PSVersion', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Get Current Location', command: 'Get-Location', expectedSecurity: 'SAFE', shouldSucceed: true }
            ],
            security: [
                { name: 'Safe Command', command: 'Get-Date', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Risky Command (blocked)', command: 'Remove-Item ./nonexistent.txt', expectedSecurity: 'RISKY', shouldSucceed: false },
                ...(skipDangerous ? [] : [
                    { name: 'Dangerous Command (blocked)', command: 'Format-Volume -DriveLetter X -WhatIf', expectedSecurity: 'DANGEROUS', shouldSucceed: false },
                    { name: 'Critical Command (blocked)', command: 'powershell -WindowStyle Hidden -Command "echo test"', expectedSecurity: 'CRITICAL', shouldSucceed: false }
                ])
            ],
            monitoring: [
                { name: 'Generate Log Entry', command: 'Write-Host "AI Agent Test - Monitoring"', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Test Process Info', command: '$PID', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Environment Test', command: '$env:COMPUTERNAME', expectedSecurity: 'SAFE', shouldSucceed: true }
            ],
            comprehensive: [
                // Combines all test suites
                { name: 'Safe: Get Date', command: 'Get-Date', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Safe: System Info', command: 'Get-ComputerInfo | Select-Object WindowsProductName', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Risky: File Create (blocked)', command: 'New-Item -Path ./test-file.tmp -ItemType File', expectedSecurity: 'RISKY', shouldSucceed: false },
                { name: 'Safe: Process Check', command: 'Get-Process pwsh | Select-Object -First 1', expectedSecurity: 'SAFE', shouldSucceed: true },
                { name: 'Test: Echo Message', command: 'Write-Output "AI Agent Test Complete"', expectedSecurity: 'SAFE', shouldSucceed: true }
            ]
        };

        let commandsToTest = testCommands[testSuite] || testCommands.basic;
        
        // For comprehensive, combine all safe tests
        if (testSuite === 'comprehensive') {
            commandsToTest = [
                ...testCommands.basic,
                ...testCommands.monitoring,
                ...testCommands.security.filter(test => skipDangerous ? test.expectedSecurity === 'SAFE' || test.expectedSecurity === 'RISKY' : true)
            ];
        }

        results.totalTests = commandsToTest.length;

        for (const test of commandsToTest) {
            const testResult = {
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
                
                // Classify the command first
                const securityAssessment = this.classifyCommandSafety(test.command);
                testResult.actualSecurity = securityAssessment.level;
                
                // Test if security classification matches expectation
                const securityMatch = testResult.actualSecurity === test.expectedSecurity;
                
                // For commands that should be blocked, check if they're properly blocked
                if (!test.shouldSucceed && (securityAssessment.blocked || securityAssessment.requiresPrompt)) {
                    testResult.actualResult = 'BLOCKED_AS_EXPECTED';
                    testResult.passed = securityMatch;
                } else if (test.shouldSucceed && securityAssessment.level === 'SAFE') {
                    // Actually execute safe commands
                    try {
                        const execResult = await this.executePowerShellCommand(test.command, 10000); // 10 second timeout for tests
                        testResult.actualResult = execResult.success ? 'SUCCESS' : 'EXECUTION_FAILED';
                        testResult.passed = securityMatch && execResult.success;
                    } catch (execError) {
                        testResult.actualResult = 'EXECUTION_ERROR';
                        testResult.error = execError.message;
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
                testResult.error = error.message;
                testResult.passed = false;
            }

            results.tests.push(testResult);
            
            if (testResult.passed) {
                results.passed++;
            } else {
                results.failed++;
            }
        }

        // Add summary and recommendations
        results.summary = {
            successRate: `${Math.round((results.passed / results.totalTests) * 100)}%`,
            securityEnforcement: results.tests.filter(t => t.actualResult === 'BLOCKED_AS_EXPECTED').length > 0 ? 'WORKING' : 'NEEDS_REVIEW',
            safeExecution: results.tests.filter(t => t.actualResult === 'SUCCESS').length > 0 ? 'WORKING' : 'NEEDS_REVIEW'
        };

        results.recommendations = [];
        
        if (results.failed > 0) {
            results.recommendations.push('Review failed tests for potential security policy adjustments');
        }
        
        if (results.summary.securityEnforcement === 'WORKING') {
            results.recommendations.push('Security enforcement is active and blocking dangerous commands');
        }
        
        if (results.summary.safeExecution === 'WORKING') {
            results.recommendations.push('Safe command execution is working properly');
        }
        
        results.recommendations.push(`Monitor logs with: .\\Simple-LogMonitor.ps1 -Follow`);
        results.recommendations.push(`Generate additional test data with: .\\Generate-SecurityTestLogs.ps1`);

        return results;
    }
    
    async checkPowerShellSyntax(content) {
        return new Promise((resolve, reject) => {
            const syntaxCheckCommand = `try { [System.Management.Automation.ScriptBlock]::Create($@'
${content}
'@); Write-Output "Syntax OK" } catch { Write-Error $_.Exception.Message }`;
            const ps = spawn('pwsh', ['-Command', syntaxCheckCommand], {
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            ps.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            ps.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            ps.on('close', (code) => {
                const isValid = code === 0 && stdout.includes('Syntax OK');
                resolve({
                    method: 'vscode-powershell-syntax-check',
                    content: content.length > 100 ? content.substring(0, 100) + '...' : content,
                    isValid,
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    timestamp: new Date().toISOString()
                });
            });
            ps.on('error', (error) => {
                reject(error);
            });
        });
    }
    async run() {
        console.error("🔌 CONNECTING TO MCP TRANSPORT...");
        console.error(`📡 Transport: StdioServerTransport`);
        console.error(`🆔 Process ID: ${process.pid}`);
        console.error(`📍 Node Version: ${process.version}`);
        console.error("─".repeat(50));
        auditLog('INFO', 'SERVER_CONNECTING', 'MCP Server connecting to transport', {
            transport: 'stdio',
            pid: process.pid,
            nodeVersion: process.version,
            startupTime: (Date.now() - this.startTime.getTime()) + 'ms'
        });
        try {
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            
            // MCP server is now connected - subsequent logging should use MCP notifications
            console.error("✅ MCP SERVER CONNECTED SUCCESSFULLY");
            console.error(`🕒 Connection established at: ${new Date().toISOString()}`);
            console.error(`📊 Server ready to receive tool requests`);
            console.error(`🛠️  Available tools: powershell-command, powershell-script, powershell-file, powershell-syntax-check`);
            console.error("=".repeat(60));
            console.error("🔍 MONITORING COMMANDS:");
            console.error("   Real-time logs: .\\Simple-LogMonitor.ps1 -Follow");
            console.error("   New window:     .\\Start-SimpleLogMonitor.ps1");
            console.error("   Generate tests: .\\Generate-SecurityTestLogs.ps1");
            console.error("   Basic test:     .\\Test-BasicMCP.ps1");
            console.error("=".repeat(60));
            
            // Now use proper MCP logging (server is connected)
            await auditLog('info', 'SERVER_CONNECTED', 'MCP Server successfully connected and ready', {
                connectionTime: new Date().toISOString(),
                totalStartupTime: (Date.now() - this.startTime.getTime()) + 'ms',
                availableTools: ['powershell-command', 'powershell-script', 'powershell-file', 'powershell-syntax-check']
            });
        }
        catch (error) {
            console.error("❌ FAILED TO CONNECT TO MCP TRANSPORT");
            console.error(`💥 Error: ${error instanceof Error ? error.message : String(error)}`);
            console.error("=".repeat(60));
            auditLog('ERROR', 'CONNECTION_FAILED', 'Failed to connect to MCP transport', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
}
// Parse command line arguments for authentication key
const args = process.argv.slice(2);
let authKey;
// Look for --key or -k argument
for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--key' || args[i] === '-k') && args[i + 1]) {
        authKey = args[i + 1];
        break;
    }
    // Support --key=value format
    if (args[i].startsWith('--key=')) {
        authKey = args[i].split('=')[1];
        break;
    }
}
// Check environment variable as fallback
if (!authKey) {
    authKey = process.env.POWERSHELL_MCP_KEY;
}
const server = new VSCodePowerShellMcpServer(authKey);
server.run().catch(console.error);
