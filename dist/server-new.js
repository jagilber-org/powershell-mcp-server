import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { spawn } from 'child_process';
// PowerShell command execution schema
const PowerShellCommandSchema = z.object({
    command: z.string().min(1).describe('PowerShell command to execute'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
});
export class PowerShellMcpServer {
    server;
    constructor() {
        this.server = new Server({
            name: 'powershell-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'powershell-command',
                        description: 'Execute a PowerShell command directly (bypasses VS Code approval)',
                        inputSchema: zodToJsonSchema(PowerShellCommandSchema),
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
                        const result = await this.executePowerShellCommand(validatedArgs.command, validatedArgs.timeout);
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
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
    async executePowerShellCommand(command, timeout) {
        return new Promise((resolve, reject) => {
            const ps = spawn('pwsh', ['-Command', command], {
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
                reject(new Error(`Command timed out after ${timeout}ms`));
            }, timeout);
            ps.on('close', (code) => {
                clearTimeout(timer);
                const result = {
                    command,
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    success: code === 0,
                    timestamp: new Date().toISOString(),
                };
                resolve(result);
            });
            ps.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    async start() {
        // Create stdio transport for MCP communication
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
}
//# sourceMappingURL=server-new.js.map