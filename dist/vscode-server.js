import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { spawn } from 'child_process';
// Audit logging utility - sanitized for no PII
function auditLog(level, category, message, metadata) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        category,
        message,
        ...(metadata && { metadata: sanitizeMetadata(metadata) })
    };
    console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
}
// Sanitize metadata to remove PII and limit content length
function sanitizeMetadata(metadata) {
    if (!metadata)
        return undefined;
    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (typeof value === 'string') {
            // Truncate long strings but preserve structure info
            if (value.length > 100) {
                sanitized[key] = `[STRING:${value.length}chars]${value.substring(0, 50)}...${value.substring(value.length - 20)}`;
            }
            else if (key.toLowerCase().includes('path') && value.includes('\\')) {
                // Sanitize file paths - keep structure but remove user-specific parts
                sanitized[key] = value.replace(/\\Users\\[^\\]+/g, '\\Users\\[USER]');
            }
            else {
                sanitized[key] = value;
            }
        }
        else if (typeof value === 'number' || typeof value === 'boolean') {
            sanitized[key] = value;
        }
        else if (value && typeof value === 'object') {
            sanitized[key] = '[OBJECT]';
        }
    }
    return sanitized;
}
// PowerShell command execution schema
const PowerShellCommandSchema = z.object({
    command: z.string().min(1).describe('PowerShell command to execute'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for command execution'),
});
// PowerShell script execution schema
const PowerShellScriptSchema = z.object({
    script: z.string().min(1).describe('PowerShell script content to execute'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for script execution'),
});
// PowerShell file execution schema
const PowerShellFileSchema = z.object({
    filePath: z.string().min(1).describe('Path to PowerShell script file to execute'),
    parameters: z.record(z.any()).optional().describe('Parameters to pass to the script'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    workingDirectory: z.string().optional().describe('Working directory for file execution'),
});
// Safety classification for PowerShell commands
const SAFE_COMMANDS = [
    'Get-Process', 'Get-Service', 'Get-ChildItem', 'Get-Content', 'Get-Location',
    'Get-Date', 'Get-Host', 'Get-Module', 'Get-Command', 'Get-Help',
    'Select-Object', 'Where-Object', 'Sort-Object', 'Measure-Object',
    'Format-Table', 'Format-List', 'Out-String', 'ConvertTo-Json',
    'Test-Path', 'Resolve-Path', 'Split-Path', 'Join-Path'
];
const RISKY_COMMANDS = [
    'Remove-Item', 'Delete', 'Format', 'Stop-Process', 'Stop-Service',
    'Set-ExecutionPolicy', 'Invoke-Expression', 'Invoke-Command',
    'Start-Process', 'New-Item', 'Move-Item', 'Copy-Item'
];
export class VSCodePowerShellMcpServer {
    server;
    constructor() {
        this.server = new Server({
            name: 'vscode-powershell-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    classifyCommandSafety(command) {
        const lowerCommand = command.toLowerCase();
        // Check for safe commands
        if (SAFE_COMMANDS.some(safe => lowerCommand.includes(safe.toLowerCase()))) {
            return 'safe';
        }
        // Check for risky commands
        if (RISKY_COMMANDS.some(risky => lowerCommand.includes(risky.toLowerCase()))) {
            return 'risky';
        }
        // Check for dangerous patterns
        if (lowerCommand.includes('rm -rf') ||
            lowerCommand.includes('del /f') ||
            lowerCommand.includes('format') ||
            lowerCommand.includes('shutdown') ||
            lowerCommand.includes('restart')) {
            return 'dangerous';
        }
        return 'risky'; // Default to risky for unknown commands
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'powershell-command',
                        description: 'Execute a PowerShell command with safety classification and VS Code integration',
                        inputSchema: zodToJsonSchema(PowerShellCommandSchema),
                    },
                    {
                        name: 'powershell-script',
                        description: 'Execute a PowerShell script with multiple lines in VS Code environment',
                        inputSchema: zodToJsonSchema(PowerShellScriptSchema),
                    },
                    {
                        name: 'powershell-file',
                        description: 'Execute a PowerShell script file with optional parameters in VS Code',
                        inputSchema: zodToJsonSchema(PowerShellFileSchema),
                    },
                    {
                        name: 'powershell-syntax-check',
                        description: 'Check PowerShell script syntax without execution',
                        inputSchema: zodToJsonSchema(z.object({
                            content: z.string().min(1).describe('PowerShell script content to check'),
                        })),
                    },
                ],
            };
        });
        // Handle tool execution
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'powershell-command': {
                        const validatedArgs = PowerShellCommandSchema.parse(args);
                        const result = await this.executePowerShellCommand(validatedArgs.command, validatedArgs.timeout, validatedArgs.workingDirectory);
                        return {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2) + `\n\n[AUDIT-LOG] ${new Date().toISOString()} - Command executed successfully`
                                }],
                        };
                    }
                    case 'powershell-script': {
                        const validatedArgs = PowerShellScriptSchema.parse(args);
                        const result = await this.executePowerShellScript(validatedArgs.script, validatedArgs.timeout, validatedArgs.workingDirectory);
                        return {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2) + `\n\n[AUDIT-LOG] ${new Date().toISOString()} - Command executed successfully`
                                }],
                        };
                    }
                    case 'powershell-file': {
                        const validatedArgs = PowerShellFileSchema.parse(args);
                        const result = await this.executePowerShellFile(validatedArgs.filePath, validatedArgs.parameters, validatedArgs.timeout, validatedArgs.workingDirectory);
                        return {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2) + `\n\n[AUDIT-LOG] ${new Date().toISOString()} - Command executed successfully`
                                }],
                        };
                    }
                    case 'powershell-syntax-check': {
                        const validatedArgs = z.object({
                            content: z.string().min(1),
                        }).parse(args);
                        const result = await this.checkPowerShellSyntax(validatedArgs.content);
                        return {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2) + `\n\n[AUDIT-LOG] ${new Date().toISOString()} - Command executed successfully`
                                }],
                        };
                    }
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                if (error instanceof McpError) {
                    throw error;
                }
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
            }
        });
    }
    async executePowerShellCommand(command, timeout = 30000, workingDirectory) {
        console.log(`[MCP-AUDIT] ${new Date().toISOString()} - Command execution started: ${command.substring(0, 50)}${command.length > 50 ? "..." : ""}`);
        auditLog('INFO', 'COMMAND_START', 'PowerShell command execution started', {
            command: command.length > 50 ? command.substring(0, 50) + '...' : command,
            timeout: timeout,
            workingDirectory: workingDirectory || 'default'
        });
        return new Promise((resolve, reject) => {
            const safety = this.classifyCommandSafety(command);
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
                    workingDirectory: workingDirectory || process.cwd(),
                };
                resolve(result);
            });
            ps.on('error', (error) => {
                clearTimeout(timer);
                reject(new Error(`Process spawn error: ${error.message}`));
            });
        });
    }
    async executePowerShellScript(script, timeout = 30000, workingDirectory) {
        auditLog('INFO', 'COMMAND_START', 'PowerShell command execution started', {
            command: command.length > 50 ? command.substring(0, 50) + '...' : command,
            timeout: timeout,
            workingDirectory: workingDirectory || 'default'
        });
        return new Promise((resolve, reject) => {
            const safety = this.classifyCommandSafety(script);
            const options = {
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            };
            if (workingDirectory) {
                options.cwd = workingDirectory;
            }
            const ps = spawn('pwsh', ['-Command', '-'], options);
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
                const result = {
                    method: 'vscode-powershell-script',
                    script: script.substring(0, 100) + (script.length > 100 ? '...' : ''),
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    success: code === 0,
                    safety,
                    timestamp: new Date().toISOString(),
                    workingDirectory: workingDirectory || process.cwd(),
                };
                resolve(result);
            });
            ps.on('error', (error) => {
                clearTimeout(timer);
                reject(new Error(`Script execution error: ${error.message}`));
            });
            // Send script to PowerShell
            ps.stdin?.write(script);
            ps.stdin?.end();
        });
    }
    async executePowerShellFile(filePath, parameters, timeout = 30000, workingDirectory) {
        let command = `& "${filePath}"`;
        if (parameters) {
            for (const [key, value] of Object.entries(parameters)) {
                if (typeof value === 'string') {
                    command += ` -${key} "${value}"`;
                }
                else {
                    command += ` -${key} ${value}`;
                }
            }
        }
        const result = await this.executePowerShellCommand(command, timeout, workingDirectory);
        return {
            ...result,
            method: 'vscode-powershell-file',
            filePath,
            parameters,
        };
    }
    async checkPowerShellSyntax(content) {
        auditLog('INFO', 'COMMAND_START', 'PowerShell command execution started', {
            command: command.length > 50 ? command.substring(0, 50) + '...' : command,
            timeout: timeout,
            workingDirectory: workingDirectory || 'default'
        });
        return new Promise((resolve, reject) => {
            const syntaxCheckCommand = `
        try {
          [System.Management.Automation.PSParser]::Tokenize(@"
${content}
"@, [ref]$null) | Out-Null
          Write-Output "Syntax OK"
        } catch {
          Write-Error $_.Exception.Message
        }
      `;
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
            const timer = setTimeout(() => {
                ps.kill();
                reject(new Error('Syntax check timed out'));
            }, 10000);
            ps.on('close', (code) => {
                clearTimeout(timer);
                const result = {
                    method: 'vscode-powershell-syntax-check',
                    content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    syntaxValid: code === 0 && stdout.includes('Syntax OK'),
                    timestamp: new Date().toISOString(),
                };
                resolve(result);
            });
            ps.on('error', (error) => {
                clearTimeout(timer);
                reject(new Error(`Syntax check error: ${error.message}`));
            });
        });
    }
    async start() {
        // VS Code MCP servers use stdio transport
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
    async stop() {
        // Clean shutdown
        console.log('VS Code PowerShell MCP server stopping...');
    }
}
// Entry point for VS Code MCP server
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('vscode-server.js')) {
    const server = new VSCodePowerShellMcpServer();
    server.start().catch((error) => {
        console.error('Failed to start VS Code PowerShell MCP server:', error);
        process.exit(1);
    });
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nReceived SIGINT, shutting down VS Code PowerShell MCP server gracefully...');
        await server.stop();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        console.log('\nReceived SIGTERM, shutting down VS Code PowerShell MCP server gracefully...');
        await server.stop();
        process.exit(0);
    });
}
//# sourceMappingURL=vscode-server.js.map


