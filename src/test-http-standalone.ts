// Standalone HTTP server test runner
// import { PowerShellMcpServer } from './server.js';

console.log('Starting PowerShell MCP Server in standalone HTTP mode...');

// const server = new PowerShellMcpServer();

// Don't start MCP stdio transport, just run the HTTP server
console.log('HTTP server should be running on http://localhost:8384');
console.log('HTTP server key: mcp-powershell-12345');
console.log('Press Ctrl+C to stop the server');

// Keep the process alive
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  // await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  // await server.stop();
  process.exit(0);
});
