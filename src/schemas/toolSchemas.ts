import { z } from 'zod';

// Core PowerShell execution schema
export const RunPowerShellSchema = z.object({
  command: z.string().optional().describe('PowerShell command to execute'),
  script: z.string().optional().describe('PowerShell script to execute (alternative to command)'),
  workingDirectory: z.string().optional().describe('Working directory for execution'),
  timeoutSeconds: z.number().min(1).max(600).optional().describe('Execution timeout in seconds (1-600)'),
  confirmed: z.boolean().optional().describe('Required confirmation for RISKY/UNKNOWN commands'),
  // Adaptive timeout parameters
  progressAdaptive: z.boolean().optional().describe('Enable adaptive timeout extension based on output activity'),
  adaptiveExtendWindowMs: z.number().optional().describe('Window for detecting recent activity (default: 2000ms)'),
  adaptiveExtendStepMs: z.number().optional().describe('Amount to extend timeout per step (default: 5000ms)'),
  adaptiveMaxTotalSec: z.number().optional().describe('Maximum total timeout with extensions (default: min(base*3, 180))'),
}).refine(data => data.command || data.script, {
  message: "Either 'command' or 'script' parameter is required",
});

// Administrative operations schema
export const AdminSchema = z.object({
  action: z.enum(['server', 'security', 'learning', 'audit']).describe('Administrative action category'),
  target: z.string().describe('Specific target within the action category'),
  // Server actions
  verbose: z.boolean().optional().describe('Include verbose details (for server stats)'),
  gc: z.boolean().optional().describe('Trigger garbage collection (for memory stats)'),
  // Security actions  
  enabled: z.boolean().optional().describe('Enable/disable policy (for working-directory)'),
  allowedWriteRoots: z.array(z.string()).optional().describe('Allowed write root directories'),
  includeDetails: z.boolean().optional().describe('Include detailed entries (for threat-analysis)'),
  // Learning actions
  limit: z.number().min(1).max(100).optional().describe('Maximum number of results to return'),
  minCount: z.number().min(1).optional().describe('Minimum occurrence count for candidates'),
  normalized: z.array(z.string()).optional().describe('Array of normalized command patterns'),
  // Audit actions
  message: z.string().optional().describe('Log message to emit'),
  category: z.string().optional().describe('Prompt category to retrieve'),
  format: z.enum(['markdown', 'json']).optional().describe('Response format for prompts'),
});

// Syntax check schema
export const SyntaxCheckSchema = z.object({
  script: z.string().optional().describe('PowerShell script content to validate'),
  filePath: z.string().optional().describe('Path to PowerShell script file to validate'),
}).refine(data => data.script || data.filePath, {
  message: "Either 'script' or 'filePath' parameter is required",
});

// Help schema
export const HelpSchema = z.object({
  topic: z.string().optional().describe('Specific help topic: security, tools, admin, examples, or compliance'),
});
