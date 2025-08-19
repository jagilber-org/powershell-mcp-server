#!/usr/bin/env node

/**
 * Simple MCP Test Client to verify protocol compliance
 * Tests that server only sends JSON-RPC to stdout and logging to stderr
 */

import { spawn } from 'child_process';
import * as readline from 'readline';

console.log('🧪 Testing Enterprise MCP Server Protocol Compliance...');

const serverProcess = spawn('node', ['dist/vscode-server-enterprise.js'], {
    stdio: ['pipe', 'pipe', 'pipe']  // stdin, stdout, stderr
});

let stdoutLines = [];
let stderrLines = [];

// Monitor stdout (should only contain JSON-RPC)
const stdoutReader = readline.createInterface({
    input: serverProcess.stdout,
    crlfDelay: Infinity
});

stdoutReader.on('line', (line) => {
    stdoutLines.push(line);
    console.log(`📤 STDOUT: ${line}`);
    
    // Try to parse as JSON-RPC
    try {
        JSON.parse(line);
        console.log('✅ Valid JSON detected on stdout');
    } catch (e) {
        console.log('❌ Non-JSON detected on stdout - MCP violation!');
    }
});

// Monitor stderr (should contain server logging)
const stderrReader = readline.createInterface({
    input: serverProcess.stderr,
    crlfDelay: Infinity
});

stderrReader.on('line', (line) => {
    stderrLines.push(line);
    console.log(`📤 STDERR: ${line}`);
});

// Send initialize request after server starts
setTimeout(() => {
    console.log('\n🚀 Sending MCP initialize request...');
    
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
}, 2000);

// Send tools/list request
setTimeout(() => {
    console.log('\n🔧 Sending tools/list request...');
    
    const toolsRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    };
    
    serverProcess.stdin.write(JSON.stringify(toolsRequest) + '\n');
}, 4000);

// Stop test after 8 seconds
setTimeout(() => {
    console.log('\n🏁 Test complete. Analyzing results...');
    
    console.log(`\n📊 RESULTS:`);
    console.log(`• STDOUT lines: ${stdoutLines.length}`);
    console.log(`• STDERR lines: ${stderrLines.length}`);
    
    console.log(`\n✅ PROTOCOL COMPLIANCE:`);
    console.log(`• Logging to stderr: ${stderrLines.length > 0 ? '✅' : '❌'}`);
    console.log(`• JSON-RPC to stdout: ${stdoutLines.length > 0 ? '✅' : '❌'}`);
    
    const nonJsonStdout = stdoutLines.filter(line => {
        try {
            JSON.parse(line);
            return false;
        } catch {
            return true;
        }
    });
    
    console.log(`• Pure JSON on stdout: ${nonJsonStdout.length === 0 ? '✅' : '❌'}`);
    
    if (nonJsonStdout.length > 0) {
        console.log(`❌ Non-JSON lines on stdout:`);
        nonJsonStdout.forEach(line => console.log(`   "${line}"`));
    }
    
    serverProcess.kill();
    process.exit(0);
}, 8000);

serverProcess.on('error', (error) => {
    console.error('❌ Server error:', error);
    process.exit(1);
});

serverProcess.on('exit', (code, signal) => {
    console.log(`\n🛑 Server exited with code ${code}, signal ${signal}`);
});
