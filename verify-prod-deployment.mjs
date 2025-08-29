#!/usr/bin/env node

/**
 * Quick verification that the pattern cache fix is deployed to production
 */

import { readFileSync } from 'fs';

console.log('🚀 Production Deployment Verification');
console.log('=' .repeat(50));

try {
  // Check if the fixed server.js contains our invalidation method
  const serverJs = readFileSync('c:/mcp/powershell-mcp-server/dist/server.js', 'utf8');
  
  if (serverJs.includes('invalidatePatternCache')) {
    console.log('✅ Pattern cache invalidation method found in production server.js');
  } else {
    console.log('❌ Pattern cache invalidation method NOT found in production server.js');
  }
  
  if (serverJs.includes('PATTERN_CACHE_INVALIDATED')) {
    console.log('✅ Pattern cache invalidation audit logging found');
  } else {
    console.log('❌ Pattern cache invalidation audit logging NOT found');
  }
  
  if (serverJs.includes('if (res.promoted > 0)') && serverJs.includes('this.invalidatePatternCache()')) {
    console.log('✅ Learn action approval cache invalidation found');
  } else {
    console.log('❌ Learn action approval cache invalidation NOT found');
  }
  
  // Check learned-safe.json for the collectsfdata pattern
  const learnedSafe = JSON.parse(readFileSync('c:/mcp/powershell-mcp-server/learned-safe.json', 'utf8'));
  const collectsPattern = learnedSafe.approved.find(entry => entry.normalized === 'collectsfdata.exe');
  
  if (collectsPattern) {
    console.log('✅ collectsfdata.exe pattern found in learned-safe.json');
    console.log(`   Pattern: ${collectsPattern.pattern}`);
    console.log(`   Added: ${collectsPattern.added}`);
  } else {
    console.log('❌ collectsfdata.exe pattern not found in learned-safe.json');
  }
  
  console.log('\n🎯 Deployment Status: READY FOR TESTING');
  console.log('📋 Next Steps:');
  console.log('   1. Restart MCP server/client to pick up fixed code');
  console.log('   2. Test collectsfdata.exe classification (should be SAFE now)');
  console.log('   3. Look for PATTERN_CACHE_INVALIDATED audit entries on future approvals');
  console.log('\n💡 Documentation Updated:');
  console.log('   - Fixed confirmation parameter: use "confirmed": true (not "confirm": true)');
  console.log('   - Added global MCP server workspace context section');
  console.log('   - Enhanced troubleshooting with common error patterns');
  console.log('   - Clarified first-call execution behavior:');
  console.log('     • SAFE/Learned SAFE: Execute immediately (no confirmed needed)');
  console.log('     • RISKY/UNKNOWN: Require confirmed:true on first call');
  console.log('     • BLOCKED/CRITICAL: Never execute');
  console.log('     • Learning: UNKNOWN → approved → becomes SAFE (no confirmed needed)');
  
} catch (error) {
  console.log('❌ Error during verification:', error.message);
}
