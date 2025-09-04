#!/usr/bin/env node

/**
 * Test MCP Server via stdio transport from command line
 * This simulates how VS Code communicates with the MCP server
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to your MCP server
const serverPath = join(__dirname, 'dist', 'server.js');

// Test with key authentication
const authKey = 'testkey';

console.log('🧪 Testing MCP Server via stdio transport');
console.log('=' .repeat(50));
console.log(`📁 Server: ${serverPath}`);
console.log(`🔑 Auth Key: ${authKey}`);
console.log('=' .repeat(50));

// Spawn the MCP server process
const server = spawn('node', [serverPath, '--key', authKey], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let requestId = 1;

// Handle server stderr (where your logs go)
server.stderr.on('data', (data) => {
  console.log('📝 [SERVER LOG]:', data.toString().trim());
});

// Handle server stdout (MCP responses)
server.stdout.on('data', (data) => {
  console.log('📨 [MCP RESPONSE]:', data.toString().trim());
});

// Handle server errors
server.on('error', (error) => {
  console.error('❌ [SERVER ERROR]:', error);
});

// Handle server exit
server.on('close', (code) => {
  console.log(`🔚 [SERVER EXIT]: Code ${code}`);
});

// Function to send MCP request
function sendMcpRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method: method,
    params: params
  };
  
  const requestJson = JSON.stringify(request) + '\n';
  console.log('📤 [MCP REQUEST]:', requestJson.trim());
  server.stdin.write(requestJson);
}

// Wait a bit for server to start, then send test requests
setTimeout(() => {
  console.log('\n🚀 Starting MCP communication tests...\n');
  
  // Test 1: Initialize the connection
  console.log('1️⃣ Initializing MCP connection...');
  sendMcpRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {}
    },
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  });
  
  setTimeout(() => {
    // Test 2: List available tools
    console.log('\n2️⃣ Listing available tools...');
    sendMcpRequest('tools/list');
  }, 1000);
  
  setTimeout(() => {
    // Test 3: Call a PowerShell tool
    console.log('\n3️⃣ Calling PowerShell tool...');
    sendMcpRequest('tools/call', {
      name: 'powershell-command',
      arguments: {
        authKey: authKey,
        command: 'Get-Date'
      }
    });
  }, 2000);
  
  setTimeout(() => {
    // Test 4: Call another PowerShell tool
    console.log('\n4️⃣ Calling PowerShell script tool...');
    sendMcpRequest('tools/call', {
      name: 'powershell_script',
      arguments: {
        authKey: authKey,
        script: '$PSVersionTable.PSVersion'
      }
    });
  }, 3000);
  
  // Clean shutdown after tests
  setTimeout(() => {
    console.log('\n✅ Tests complete. Shutting down...');
    server.kill();
  }, 4000);
  
}, 1000);
