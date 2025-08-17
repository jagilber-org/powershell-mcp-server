import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { spawn } from 'child_process';
import http from 'http';
import { URL } from 'url';
// PowerShell command execution schema
const PowerShellCommandSchema = z.object({
    command: z.string().min(1).describe('PowerShell command to execute'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
});
// PowerShell script execution schema
const PowerShellScriptSchema = z.object({
    script: z.string().min(1).describe('PowerShell script content to execute'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
});
// PowerShell file execution schema
const PowerShellFileSchema = z.object({
    filePath: z.string().min(1).describe('Path to PowerShell script file to execute'),
    parameters: z.record(z.any()).optional().describe('Parameters to pass to the script'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
});
// PowerShell HTTP execution schema (using embedded HTTP server)
const PowerShellHttpSchema = z.object({
    command: z.string().min(1).describe('PowerShell command to execute via HTTP server'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
});
export class PowerShellMcpServer {
    server;
    httpServer = null;
    httpPort = 8384; // Different port than user's server
    httpKey = 'mcp-powershell-12345';
    isHttpServerRunning = false;
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
        this.startHttpServer();
    }
    startHttpServer() {
        this.httpServer = http.createServer((req, res) => {
            this.handleHttpRequest(req, res);
        });
        this.httpServer.listen(this.httpPort, 'localhost', () => {
            console.log(`PowerShell HTTP server listening on http://localhost:${this.httpPort}`);
            console.log(`HTTP server key: ${this.httpKey}`);
            this.isHttpServerRunning = true;
        });
        this.httpServer.on('error', (error) => {
            console.error('HTTP server error:', error);
            this.isHttpServerRunning = false;
        });
    }
    handleHttpRequest(req, res) {
        try {
            const url = new URL(req.url || '', `http://localhost:${this.httpPort}`);
            // Add CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            if (url.pathname === '/ps' && req.method === 'GET') {
                const clientKey = url.searchParams.get('key');
                const cmd = url.searchParams.get('cmd');
                if (clientKey !== this.httpKey) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid key', timestamp: new Date().toISOString() }));
                    return;
                }
                if (!cmd) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing cmd parameter', timestamp: new Date().toISOString() }));
                    return;
                }
                console.log(`HTTP server executing: ${cmd}`);
                this.executePowerShellCommand(cmd, 30000)
                    .then(result => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                })
                    .catch(error => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        command: cmd
                    }));
                });
            }
            else if (url.pathname === '/health' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'healthy',
                    server: 'PowerShell MCP Server',
                    timestamp: new Date().toISOString(),
                    port: this.httpPort
                }));
            }
            else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Not found',
                    path: url.pathname,
                    timestamp: new Date().toISOString()
                }));
            }
        }
        catch (error) {
            console.error('HTTP request handling error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Internal server error',
                timestamp: new Date().toISOString()
            }));
        }
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
                    {
                        name: 'powershell-script',
                        description: 'Execute a PowerShell script with multiple lines',
                        inputSchema: zodToJsonSchema(PowerShellScriptSchema),
                    },
                    {
                        name: 'powershell-file',
                        description: 'Execute a PowerShell script file with optional parameters',
                        inputSchema: zodToJsonSchema(PowerShellFileSchema),
                    },
                    {
                        name: 'powershell-http',
                        description: 'Execute PowerShell command via embedded HTTP server (most reliable)',
                        inputSchema: zodToJsonSchema(PowerShellHttpSchema),
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
                            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        };
                    }
                    case 'powershell-script': {
                        const validatedArgs = PowerShellScriptSchema.parse(args);
                        const result = await this.executePowerShellScript(validatedArgs.script, validatedArgs.timeout);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        };
                    }
                    case 'powershell-file': {
                        const validatedArgs = PowerShellFileSchema.parse(args);
                        const result = await this.executePowerShellFile(validatedArgs.filePath, validatedArgs.parameters, validatedArgs.timeout);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        };
                    }
                    case 'powershell-http': {
                        const validatedArgs = PowerShellHttpSchema.parse(args);
                        const result = await this.executePowerShellViaHttp(validatedArgs.command, validatedArgs.timeout);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
                    method: 'direct-spawn',
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
                reject(new Error(`Process spawn error: ${error.message}`));
            });
        });
    }
    async executePowerShellScript(script, timeout) {
        return new Promise((resolve, reject) => {
            const ps = spawn('pwsh', ['-Command', '-'], {
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
                reject(new Error(`Script timed out after ${timeout}ms`));
            }, timeout);
            ps.on('close', (code) => {
                clearTimeout(timer);
                const result = {
                    method: 'script-stdin',
                    script: script.substring(0, 100) + (script.length > 100 ? '...' : ''),
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
                reject(new Error(`Script execution error: ${error.message}`));
            });
            // Send script to PowerShell
            ps.stdin?.write(script);
            ps.stdin?.end();
        });
    }
    async executePowerShellFile(filePath, parameters, timeout = 30000) {
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
        const result = await this.executePowerShellCommand(command, timeout);
        return {
            ...result,
            method: 'file-execution',
            filePath,
            parameters,
        };
    }
    async executePowerShellViaHttp(command, timeout) {
        if (!this.isHttpServerRunning) {
            throw new Error('HTTP server is not running');
        }
        return new Promise((resolve, reject) => {
            const url = `http://localhost:${this.httpPort}/ps?key=${this.httpKey}&cmd=${encodeURIComponent(command)}`;
            const req = http.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        resolve({
                            ...result,
                            method: 'http-server',
                            httpUrl: url.replace(this.httpKey, '[REDACTED]'),
                        });
                    }
                    catch (error) {
                        reject(new Error(`Failed to parse HTTP response: ${error}`));
                    }
                });
            });
            req.on('error', (error) => {
                reject(new Error(`HTTP request failed: ${error.message}`));
            });
            const timer = setTimeout(() => {
                req.destroy();
                reject(new Error(`HTTP request timed out after ${timeout}ms`));
            }, timeout);
            req.on('close', () => {
                clearTimeout(timer);
            });
        });
    }
    async start() {
        // Create stdio transport for MCP communication
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
    async stop() {
        if (this.httpServer) {
            this.httpServer.close();
            this.isHttpServerRunning = false;
        }
    }
}
//# sourceMappingURL=server.js.map