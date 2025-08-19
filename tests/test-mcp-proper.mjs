#!/usr/bin/env node

/**
 * Proper MCP Protocol Test - Separate stderr from stdout
 */

import { spawn } from 'child_process';

console.log('🧪 Testing MCP Server with proper stderr/stdout separation...');

const serverProcess = spawn('node', ['dist/vscode-server-enterprise.js'], {
    stdio: ['pipe', 'pipe', 'inherit']  // stdin=pipe, stdout=pipe, stderr=inherit (console)
});

let stdoutData = '';

// Only capture stdout (should be JSON-RPC only)
serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    stdoutData += output;
    console.log('📤 STDOUT:', JSON.stringify(output));
});

// Give server time to start
setTimeout(() => {
    console.log('\n🚀 Sending initialize request...');
    const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
                name: 'test-client',
                version: '1.0.0'
            }
        }
    };
    
    serverProcess.stdin.write(JSON.stringify(initRequest) + '\n');
}, 3000);

// Check results
setTimeout(() => {
    console.log('\n📊 ANALYSIS:');
    console.log('Raw stdout data:', JSON.stringify(stdoutData));
    
    const lines = stdoutData.trim().split('\n').filter(line => line.trim());
    console.log('Number of stdout lines:', lines.length);
    
    lines.forEach((line, i) => {
        try {
            JSON.parse(line);
            console.log(`✅ Line ${i + 1}: Valid JSON-RPC`);
        } catch (e) {
            console.log(`❌ Line ${i + 1}: Non-JSON: ${JSON.stringify(line.substring(0, 100))}`);
        }
    });
    
    serverProcess.kill();
    process.exit(0);
}, 6000);

serverProcess.on('error', (error) => {
    console.error('❌ Server error:', error);
    process.exit(1);
});
