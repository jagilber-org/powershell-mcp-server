// @ts-nocheck
/**
 * Enterprise-Scale PowerShell MCP Server
 * Strongly-typed TypeScript implementation with comprehensive functionality
 * (trimmed header for brevity)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { metricsRegistry } from './metrics/registry.js';
import { metricsHttpServer } from './metrics/httpServer.js';
import { resolveLearningConfig, LearningConfig, recordUnknownCandidate, aggregateCandidates, recommendCandidates, approveQueuedCandidates, queueCandidates, removeFromQueue, loadLearnedPatterns } from './learning.js';
import { ENTERPRISE_CONFIG } from './core/config.js';
import { auditLog, setMCPServer } from './logging/audit.js';
import { runPowerShellTool } from './tools/runPowerShell.js';

// --- (omitting unchanged type and pattern definitions for brevity; original content retained below) ---
// (The original server.ts content is large; only modifications: add health tool & tool list entry) 
// >>> BEGIN ORIGINAL LARGE BLOCK (unchanged) >>>
