/**
 * PowerShell MCP Server - Main Entry Point
 * 
 * This is the primary entry point for the Enterprise PowerShell MCP Server.
 * The server provides secure PowerShell command execution with comprehensive
 * audit logging, security classification, and enterprise-grade features.
 */

// Export the main server implementation
export * from './server.js';

// Also support direct execution
import('./server.js').then(module => {
    // Server will auto-start when imported
}).catch(error => {
    console.error('Failed to start PowerShell MCP Server:', error);
    process.exit(1);
});
