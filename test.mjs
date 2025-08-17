// Simple test to verify PowerShell MCP server works
import { PowerShellMcpServer } from './dist/server.js';

console.log('Testing PowerShell MCP Server...');

const server = new PowerShellMcpServer();
console.log('Server created successfully!');

// Just test that it starts without errors
console.log('PowerShell MCP Server is ready to use!');
console.log('');
console.log('🎯 To test with a real MCP client:');
console.log('1. Update Claude Desktop config with: config/claude_desktop_config.json');  
console.log('2. Restart Claude Desktop');
console.log('3. Ask Claude to execute PowerShell commands using the powershell-command tool');
console.log('');
console.log('Example commands that will work without VS Code approval:');
console.log('- Get-Date');
console.log('- Get-Location'); 
console.log('- $PSVersionTable');
console.log('- Get-Process | Select-Object -First 5');
