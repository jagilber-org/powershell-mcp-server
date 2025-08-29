#!/usr/bin/env node

/**
 * Test script to verify the learning system pattern cache bug fix
 * 
 * Bug: Learning system approval (collectsfdata.exe pattern ^collectsfdata\.exe$) 
 * not affecting runtime security classification. Commands still require confirmation 
 * and classified as UNKNOWN despite successful learn->approve workflow.
 * Learning system appears disconnected from classification engine.
 * 
 * Root cause: mergedPatterns cache is never invalidated when new patterns are approved
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';

function testClassification(command) {
  return new Promise((resolve, reject) => {
    const server = spawn('node', ['c:/mcp/powershell-mcp-server/dist/server.js'], {
      cwd: 'c:/mcp/powershell-mcp-server'
    });
    
    let output = '';
    server.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    server.stderr.on('data', (data) => {
      // Ignore stderr (startup messages)
    });
    
    // Wait for server ready, then test classification via run-powershell
    setTimeout(() => {
      const testRequest = {
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'tools/call',
        params: {
          name: 'run-powershell',
          arguments: {
            command: command,
            timeout: 1  // Very short timeout since we just want classification
          }
        }
      };
      
      server.stdin.write(JSON.stringify(testRequest) + '\n');
      
      setTimeout(() => {
        server.kill();
        
        // Parse the response to extract security classification
        const lines = output.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === 'test-1') {
              const structured = response.result?.structuredContent;
              if (structured) {
                resolve({
                  command,
                  level: structured.securityAssessment?.level,
                  reason: structured.securityAssessment?.reason,
                  requiresPrompt: structured.securityAssessment?.requiresPrompt
                });
                return;
              }
            }
          } catch {}
        }
        reject(new Error('No valid response found'));
      }, 2000);
    }, 1000);
  });
}

async function main() {
  console.log('🔍 Testing Learning System Pattern Cache Bug Fix');
  console.log('=' .repeat(60));
  
  // Verify the learned pattern exists in learned-safe.json
  console.log('1. Checking learned-safe.json for collectsfdata.exe pattern...');
  try {
    const learnedSafe = JSON.parse(readFileSync('c:/mcp/powershell-mcp-server/learned-safe.json', 'utf8'));
    const collectsPattern = learnedSafe.approved.find(entry => 
      entry.normalized === 'collectsfdata.exe'
    );
    
    if (collectsPattern) {
      console.log(`   ✅ Found pattern: ${collectsPattern.pattern}`);
      console.log(`   📅 Added: ${collectsPattern.added}`);
      console.log(`   🔧 Source: ${collectsPattern.source}`);
    } else {
      console.log('   ❌ collectsfdata.exe pattern not found in learned-safe.json');
      return;
    }
  } catch (e) {
    console.log(`   ❌ Error reading learned-safe.json: ${e.message}`);
    return;
  }
  
  console.log('\n2. Testing runtime classification...');
  try {
    const result = await testClassification('collectsfdata.exe');
    console.log(`   Command: ${result.command}`);
    console.log(`   Level: ${result.level}`);
    console.log(`   Reason: ${result.reason}`);
    console.log(`   Requires Prompt: ${result.requiresPrompt}`);
    
    if (result.level === 'SAFE' && !result.requiresPrompt) {
      console.log('\n🎉 SUCCESS: collectsfdata.exe is now properly classified as SAFE!');
      console.log('   ✅ Learning system integration working correctly');
      console.log('   ✅ Pattern cache invalidation working');
    } else {
      console.log('\n❌ BUG STILL PRESENT: collectsfdata.exe should be SAFE but is classified as:', result.level);
      console.log('   🐛 Pattern cache invalidation may not be working');
    }
  } catch (e) {
    console.log(`   ❌ Error testing classification: ${e.message}`);
  }
  
  console.log('\n' + '=' .repeat(60));
}

main().catch(console.error);
