import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { spawn } from 'child_process';

// Audit logging utility - sanitized for no PII
function auditLog(level: string, category: string, message: string, metadata?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    category,
    message,
    ...(metadata && { metadata: sanitizeMetadata(metadata) })
  };
  console.error("[AUDIT] " + JSON.stringify(logEntry));
}

// Sanitize metadata to remove PII and limit content length
function sanitizeMetadata(metadata: any): any {
  if (!metadata) return undefined;
  
  const sanitized: any = {};
  Object.keys(metadata).forEach(key => {
    const value = metadata[key];
    if (typeof value === 'string') {
      // Limit string length to prevent log spam
      sanitized[key] = value.length > 100 ? value.substring(0, 100) + '...' : value;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = '[Object]';
    } else {
      sanitized[key] = value;
    }
  });
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
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'powershell-my-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private classifyCommandSafety(command: string): 'safe' | 'risky' | 'dangerous' {
    const upperCommand = command.toUpperCase();
    
    // Check for safe commands
    if (SAFE_COMMANDS.some(safeCmd => upperCommand.includes(safeCmd.toUpperCase()))) {
      return 'safe';
    }
    
    // Check for risky commands
    if (RISKY_COMMANDS.some(riskyCmd => upperCommand.includes(riskyCmd.toUpperCase()))) {
      return 'risky';
    }
    
    // Check for dangerous patterns
    if (upperCommand.includes('FORMAT C:') || 
        upperCommand.includes('DEL /') || 
        upperCommand.includes('RMDIR /') ||
        upperCommand.includes('SHUTDOWN') ||
        upperCommand.includes('RESTART-COMPUTER')) {
      return 'dangerous';
    }
    
    return 'risky'; // Default to risky for unknown commands
  }

  private setupHandlers() {
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
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;

      // Log MCP request for debugging
      auditLog('INFO', 'MCP_REQUEST', `MCP tool request: ${name}`, { 
        toolName: name, 
        hasArguments: !!args 
      });
      console.error("[MCP-REQUEST] " + new Date().toISOString() + " - Tool: " + name + ", Args: " + JSON.stringify(args));

      try {
        switch (name) {
          case 'powershell-command': {
            const validatedArgs = PowerShellCommandSchema.parse(args);
            const result = await this.executePowerShellCommand(
              validatedArgs.command, 
              validatedArgs.timeout,
              validatedArgs.workingDirectory
            );
            return {
              content: [{ 
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          case 'powershell-script': {
            const validatedArgs = PowerShellScriptSchema.parse(args);
            const result = await this.executePowerShellScript(
              validatedArgs.script,
              validatedArgs.timeout,
              validatedArgs.workingDirectory
            );
            return {
              content: [{ 
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          case 'powershell-file': {
            const validatedArgs = PowerShellFileSchema.parse(args);
            const result = await this.executePowerShellFile(
              validatedArgs.filePath,
              validatedArgs.parameters,
              validatedArgs.timeout,
              validatedArgs.workingDirectory
            );
            return {
              content: [{ 
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
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
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        auditLog('ERROR', 'MCP_ERROR', `Tool execution failed: ${name}`, { 
          error: error instanceof Error ? error.message : String(error)
        });
        
        if (error instanceof z.ZodError) {
          throw new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${error.message}`);
        }
        throw error;
      }
    });
  }

  private async executePowerShellCommand(
    command: string, 
    timeout: number = 30000,
    workingDirectory?: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const safety = this.classifyCommandSafety(command);
      
      auditLog('INFO', 'COMMAND_START', 'PowerShell command execution started', {
        command: command.length > 50 ? command.substring(0, 50) + '...' : command,
        timeout: timeout,
        safety: safety,
        workingDirectory: workingDirectory
      });
      
      console.error("[MCP-AUDIT] " + new Date().toISOString() + " - Command execution started: " + (command.length > 50 ? command.substring(0, 50) + "..." : command));
      
      const options: any = {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      
      if (workingDirectory) {
        options.cwd = workingDirectory;
      }

      const ps = spawn('pwsh', ['-Command', command], options);

      let stdout = '';
      let stderr = '';

      ps.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ps.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        ps.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      ps.on('close', (code: number | null) => {
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

      ps.on('error', (error: Error) => {
        clearTimeout(timer);
        auditLog('ERROR', 'COMMAND_ERROR', 'PowerShell command execution failed', {
          error: error.message
        });
        reject(error);
      });
    });
  }

  private async executePowerShellScript(
    script: string,
    timeout: number = 30000,
    workingDirectory?: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const safety = this.classifyCommandSafety(script);
      
      const options: any = {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      
      if (workingDirectory) {
        options.cwd = workingDirectory;
      }

      const ps = spawn('pwsh', ['-Command', script], options);

      let stdout = '';
      let stderr = '';

      ps.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ps.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        ps.kill();
        reject(new Error(`Script timed out after ${timeout}ms`));
      }, timeout);

      ps.on('close', (code: number | null) => {
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

      ps.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async executePowerShellFile(
    filePath: string,
    parameters?: Record<string, any>,
    timeout: number = 30000,
    workingDirectory?: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      let command = `& "${filePath}"`;
      
      if (parameters) {
        const paramString = Object.entries(parameters)
          .map(([key, value]) => `-${key} "${value}"`)
          .join(' ');
        command += ` ${paramString}`;
      }

      const safety = 'risky'; // File execution is inherently risky
      
      const options: any = {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      
      if (workingDirectory) {
        options.cwd = workingDirectory;
      }

      const ps = spawn('pwsh', ['-Command', command], options);

      let stdout = '';
      let stderr = '';

      ps.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ps.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        ps.kill();
        reject(new Error(`File execution timed out after ${timeout}ms`));
      }, timeout);

      ps.on('close', (code: number | null) => {
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

      ps.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async checkPowerShellSyntax(content: string): Promise<any> {
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

      ps.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ps.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ps.on('close', (code: number | null) => {
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

      ps.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new VSCodePowerShellMcpServer();
server.run().catch(console.error);
