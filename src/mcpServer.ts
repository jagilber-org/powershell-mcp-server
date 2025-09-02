/**
 * MCP-Compliant PowerShell Server
 * 
 * Fully compliant with Model Context Protocol specification
 * - Proper Zod schema validation
 * - Unified tool surface with hierarchical admin structure
 * - Consistent error handling with confirmed parameter
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  McpError, 
  ErrorCode, 
  InitializeRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as fs from 'fs';
import * as path from 'path';

// Import schemas
import { RunPowerShellSchema, AdminSchema, SyntaxCheckSchema, HelpSchema } from './schemas/toolSchemas.js';

// Import existing functionality
import { runPowerShellTool } from './tools/runPowerShell.js';
import { ENTERPRISE_CONFIG } from './core/config.js';
import { auditLog, setMCPServer } from './logging/audit.js';
import { metricsRegistry } from './metrics/registry.js';
import { 
  aggregateCandidates, 
  recommendCandidates, 
  queueCandidates, 
  approveQueuedCandidates, 
  removeFromQueue 
} from './learning.js';
import { parsePowerShellSyntax } from './tools/pwshSyntax.js';

export class MCPCompliantPowerShellServer {
  private server: Server;
  private startTime: Date;
  private commandCount = 0;

  constructor() {
    this.server = new Server(
      { name: 'powershell-mcp-server', version: '2.1.0' },
      { capabilities: { tools: { listChanged: true } } }
    );
    this.startTime = new Date();
    this.setupHandlers();
    setMCPServer(this.server);
  }

  private setupHandlers(): void {
    // Tool listing with MCP-compliant schemas
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'run-powershell',
          description: 'Execute PowerShell command or script with security classification and timeout controls',
          inputSchema: zodToJsonSchema(RunPowerShellSchema),
        },
        {
          name: 'admin',
          description: 'Administrative operations: server stats, security policy, learning system, and audit functions',
          inputSchema: zodToJsonSchema(AdminSchema),
        },
        {
          name: 'syntax-check',
          description: 'Validate PowerShell syntax without execution - supports both inline script and file path',
          inputSchema: zodToJsonSchema(SyntaxCheckSchema),
        },
        {
          name: 'help',
          description: 'Get help information about tools, security model, and MCP compliance features',
          inputSchema: zodToJsonSchema(HelpSchema),
        },
      ],
    }));

    // Tool execution handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      this.commandCount++;
      
      const requestId = `req_${Date.now()}_${this.commandCount}`;
      
      auditLog('INFO', 'TOOL_CALL_START', `Tool call: ${name}`, { 
        requestId, 
        toolName: name,
        hasArgs: Object.keys(args).length > 0 
      });

      try {
        switch (name) {
          case 'run-powershell':
            return await this.handleRunPowerShell(args, requestId);
          
          case 'admin':
            return await this.handleAdmin(args, requestId);
          
          case 'syntax-check':
            return await this.handleSyntaxCheck(args, requestId);
          
          case 'help':
            return await this.handleHelp(args, requestId);
          
          default:
            throw new McpError(ErrorCode.InvalidRequest, `Unknown tool: ${name}`);
        }
      } catch (error) {
        auditLog('ERROR', 'TOOL_CALL_FAILED', `Tool call failed: ${name}`, { 
          requestId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError, 
          error instanceof Error ? error.message : String(error)
        );
      }
    });

    // Initialize handler
    this.server.setRequestHandler(InitializeRequestSchema, async () => ({
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'powershell-mcp-server', version: '2.1.0' }
    }));
  }

  private async handleRunPowerShell(args: any, requestId: string) {
    // Validate with Zod schema
    const validated = RunPowerShellSchema.parse(args);
    
    // Ensure either command or script is provided
    const command = validated.command || validated.script;
    if (!command) {
      throw new McpError(ErrorCode.InvalidParams, "Either 'command' or 'script' parameter is required");
    }

    // Use existing runPowerShellTool implementation
    const result = await runPowerShellTool({ 
      ...validated, 
      command,
      _requestId: requestId 
    });
    
    return result;
  }

  private async handleAdmin(args: any, requestId: string) {
    const validated = AdminSchema.parse(args);
    const { action, target } = validated;

    switch (action) {
      case 'server':
        return await this.handleServerAdmin(target, validated, requestId);
      
      case 'security':
        return await this.handleSecurityAdmin(target, validated, requestId);
      
      case 'learning':
        return await this.handleLearningAdmin(target, validated, requestId);
      
      case 'audit':
        return await this.handleAuditAdmin(target, validated, requestId);
      
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown admin action: ${action}`);
    }
  }

  private async handleServerAdmin(target: string, args: any, requestId: string) {
    switch (target) {
      case 'stats':
        const stats = metricsRegistry.snapshot(args.verbose || false);
        return { 
          content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
          structuredContent: stats
        };
      
      case 'health':
        const mem = process.memoryUsage();
        const uptimeSec = Math.round((Date.now() - this.startTime.getTime()) / 1000);
        const health = {
          uptimeSec,
          commandCount: this.commandCount,
          memory: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
          },
          config: {
            timeoutMs: ENTERPRISE_CONFIG.limits.defaultTimeoutMs || 90000
          }
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(health, null, 2) }],
          structuredContent: health
        };
      
      case 'memory':
        if (args.gc && typeof global.gc === 'function') {
          try { global.gc(); } catch {}
        }
        const memStats = process.memoryUsage();
        const toMB = (n: number) => Math.round((n / 1024 / 1024) * 100) / 100;
        const memResult = {
          rssMB: toMB(memStats.rss),
          heapUsedMB: toMB(memStats.heapUsed),
          heapTotalMB: toMB(memStats.heapTotal),
          externalMB: toMB(memStats.external || 0),
          gcRequested: !!args.gc,
          timestamp: new Date().toISOString()
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(memResult, null, 2) }],
          structuredContent: memResult
        };
      
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown server target: ${target}`);
    }
  }

  private async handleSecurityAdmin(target: string, args: any, requestId: string) {
    switch (target) {
      case 'working-directory':
        if (args.enabled !== undefined) {
          ENTERPRISE_CONFIG.security.enforceWorkingDirectory = args.enabled;
        }
        if (args.allowedWriteRoots) {
          ENTERPRISE_CONFIG.security.allowedWriteRoots = args.allowedWriteRoots;
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(ENTERPRISE_CONFIG.security, null, 2) }],
          structuredContent: { ok: true, policy: ENTERPRISE_CONFIG.security }
        };
      
      case 'threat-analysis':
        // This would need to be implemented based on existing threat tracking
        const threatData = { summary: 'Threat analysis not fully implemented in new structure' };
        return {
          content: [{ type: 'text', text: JSON.stringify(threatData, null, 2) }],
          structuredContent: threatData
        };
      
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown security target: ${target}`);
    }
  }

  private async handleLearningAdmin(target: string, args: any, requestId: string) {
    switch (target) {
      case 'list':
        const candidates = aggregateCandidates(args.limit, args.minCount);
        return {
          content: [{ type: 'text', text: JSON.stringify({ candidates }, null, 2) }],
          structuredContent: { candidates }
        };
      
      case 'queue':
        const queued = queueCandidates(args.normalized || []);
        return {
          content: [{ type: 'text', text: JSON.stringify({ queued }, null, 2) }],
          structuredContent: { queued }
        };
      
      case 'approve':
        const approved = approveQueuedCandidates(args.normalized || []);
        return {
          content: [{ type: 'text', text: JSON.stringify({ approved }, null, 2) }],
          structuredContent: { approved }
        };
      
      case 'remove':
        const removed = removeFromQueue(args.normalized || []);
        return {
          content: [{ type: 'text', text: JSON.stringify({ removed }, null, 2) }],
          structuredContent: { removed }
        };
      
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown learning target: ${target}`);
    }
  }

  private async handleAuditAdmin(target: string, args: any, requestId: string) {
    switch (target) {
      case 'emit-log':
        if (!args.message) {
          throw new McpError(ErrorCode.InvalidParams, "Message parameter required for emit-log");
        }
        
        auditLog('INFO', 'USER_LOG', args.message, { requestId, userGenerated: true });
        return {
          content: [{ type: 'text', text: 'Log entry created successfully' }],
          structuredContent: { ok: true, logged: true }
        };
      
      case 'prompts':
        const filePath = path.join(process.cwd(), 'docs', 'AGENT-PROMPTS.md');
        let content = 'Prompts file not found';
        
        if (fs.existsSync(filePath)) {
          content = fs.readFileSync(filePath, 'utf8');
          
          if (args.category) {
            const regex = new RegExp(`(^#+.*${args.category}.*$)[\\s\\S]*?(?=^# )`, 'im');
            const match = content.match(regex);
            if (match) content = match[0];
          }
          
          // Redact secret blocks
          content = content.replace(/```secret[\r\n]+[\s\S]*?```/gi, '[SECRET BLOCK REDACTED]');
          
          // Truncate if too large
          const maxChars = 4000;
          if (content.length > maxChars) {
            content = content.slice(0, maxChars) + '...TRUNCATED...';
          }
        }
        
        if (args.format === 'json') {
          const result = {
            category: args.category || 'all',
            content: content.split(/\r?\n/)
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result
          };
        }
        
        return { content: [{ type: 'text', text: content }] };
      
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown audit target: ${target}`);
    }
  }

  private async handleSyntaxCheck(args: any, requestId: string) {
    const validated = SyntaxCheckSchema.parse(args);
    
    let script = validated.script;
    
    if (validated.filePath && !script) {
      if (!fs.existsSync(validated.filePath)) {
        throw new McpError(ErrorCode.InvalidRequest, 'Script file not found');
      }
      script = fs.readFileSync(validated.filePath, 'utf8');
    }
    
    if (!script) {
      throw new McpError(ErrorCode.InvalidParams, "Either 'script' or 'filePath' parameter is required");
    }
    const result = await parsePowerShellSyntax(script);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  }

  private async handleHelp(args: any, requestId: string) {
    const validated = HelpSchema.parse(args);
    
    const helpContent: Record<string, string> = {
      security: 'Security classification system: SAFE (executes immediately), RISKY/UNKNOWN (require confirmed: true), BLOCKED/CRITICAL (never execute). Commands are classified using pattern matching and machine learning.',
      tools: 'Available tools: run-powershell (execute commands), admin (server management), syntax-check (validate scripts), help (this help system). Use admin tool for hierarchical access to server functions.',
      admin: 'Admin tool actions: server (stats/health/memory), security (policies/threats), learning (command approval), audit (logging/prompts). Each action has specific targets with relevant parameters.',
      examples: 'Basic usage: run-powershell with command:"Get-Process". RISKY commands need confirmed:true. Use admin for server stats: {action:"server", target:"stats"}.',
      compliance: 'This server is fully MCP-compliant using official @modelcontextprotocol/sdk with Zod schemas, proper error handling, and structured logging. All tools follow MCP specification requirements.'
    };
    
    if (validated.topic && helpContent[validated.topic]) {
      return { content: [{ type: 'text', text: helpContent[validated.topic] }] };
    }
    
    return {
      content: [{ type: 'text', text: JSON.stringify(helpContent, null, 2) }],
      structuredContent: helpContent
    };
  }

  async start(): Promise<void> {
  // Always use framed protocol; legacy line protocol removed
  const transport = new StdioServerTransport();
  await this.server.connect(transport);
  console.error('✅ MCP PowerShell Server Connected (Framed)');
  }
}

// Create and start server
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MCPCompliantPowerShellServer();
  server.start().catch(console.error);
}
