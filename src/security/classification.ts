// Security classification logic extracted for modularization
import { ENTERPRISE_CONFIG } from '../core/config.js';
import { loadLearnedPatterns } from '../learning.js';
import { auditLog } from '../logging/audit.js';
import { metricsRegistry } from '../metrics/registry.js';
import { metricsHttpServer } from '../metrics/httpServer.js';

export type SecurityLevel = 'SAFE' | 'RISKY' | 'DANGEROUS' | 'CRITICAL' | 'UNKNOWN' | 'BLOCKED';
export interface SecurityAssessment { level: SecurityLevel; risk: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; category: string; reason: string; blocked: boolean; requiresPrompt: boolean; color?: string; patterns?: string[]; recommendations?: string[]; }

// Basic pattern groups (extended with git / gh command heuristics)
const SAFE = [
  /^Get-/, /^Select-/, /^Where-Object/, /^Sort-Object/, /^Group-Object/,
  /git\s+status/i, /git\s+log(\s|$)/i, /git\s+show(\s|$)/i, /git\s+diff(\s|$)/i, /git\s+branch(\s|$)/i,
  /gh\s+repo\s+view/i, /gh\s+issue\s+list/i, /gh\s+pr\s+list/i
];
// RISKY: modifies working tree or remote but generally reversible
const RISKY = [
  /Remove-Item/i, /Move-Item/i, /Copy-Item/i, /Stop-Process/i,
  /git\s+add(\s|$)/i, /git\s+commit(\s|$)/i, /git\s+pull(\s|$)/i, /git\s+fetch(\s|$)/i,
  /gh\s+pr\s+checkout/i, /gh\s+pr\s+create/i, /gh\s+issue\s+create/i
];
// DANGEROUS/BLOCKED: destructive or access-altering – treat as blocked (critical) for now
const BLOCKED = [
  /Invoke-Expression/i, /Format-Volume/i, /Set-ItemProperty/i, /Remove-ItemProperty/i,
  /git\s+push\s+--force/i, /git\s+push\s+-f(\s|$)/i, /git\s+reset\s+--hard/i, /git\s+clean\s+-xfd/i,
  /git\s+rebase\s+--interactive/i, /gh\s+repo\s+delete/i, /gh\s+secret\s+set/i, /gh\s+secret\s+remove/i
];

let merged: { safe: RegExp[]; risky: RegExp[]; blocked: RegExp[] } | undefined;

export function classifyCommandSafety(command: string): SecurityAssessment {
  // Early destructive CMD pattern detection (before alias expansion) for del/rd with /s and /q
  const pre = command.toLowerCase();
  if(/\bdel\b/.test(pre) && /\/(s|q)/.test(pre) && /(\/s.*\/q|\/q.*\/s)/.test(pre)){
    return { level:'CRITICAL', risk:'CRITICAL', category:'OS_DESTRUCTIVE', reason:'Blocked OS pattern: del recursive quiet', blocked:true, requiresPrompt:false };
  }
  if(/\brd\b/.test(pre) && /\/(s|q)/.test(pre) && /(\/s.*\/q|\/q.*\/s)/.test(pre)){
    return { level:'CRITICAL', risk:'CRITICAL', category:'OS_DESTRUCTIVE', reason:'Blocked OS pattern: rd recursive quiet', blocked:true, requiresPrompt:false };
  }
    // Fast-path SAFE common listing aliases before deeper processing
    if(/^\s*(dir|ls)\b/i.test(command)){ return { level:'SAFE', risk:'LOW', category:'OS_READONLY', reason:'Safe OS pattern: dir', blocked:false, requiresPrompt:false }; }
  // Basic tokenization (first word) and alias expansion for PowerShell & common shells
  try {
    const trimmed = command.trim();
    const firstToken = trimmed.split(/\s+/)[0];
    const aliasMap: Record<string,string> = {
      ls:'Get-ChildItem', dir:'Get-ChildItem', gci:'Get-ChildItem',
      cat:'Get-Content', type:'Get-Content', gc:'Get-Content',
      rm:'Remove-Item', del:'Remove-Item', erase:'Remove-Item', rd:'Remove-Item', ri:'Remove-Item',
      cp:'Copy-Item', mv:'Move-Item', ps:'Get-Process', gps:'Get-Process', kill:'Stop-Process',
      spps:'Stop-Process', md:'New-Item', mkdir:'New-Item'
    };
    if(aliasMap[firstToken]){
      // Replace only first token for pattern matching context (keep rest intact)
      command = aliasMap[firstToken] + ' ' + trimmed.split(/\s+/).slice(1).join(' ');
    }
  } catch {}

  // OS / cmd classification regex groups
  const OS_BLOCKED = [
    /\bformat(\.exe)?\b/i,
    /\bshutdown(\.exe)?\b/i,
    /\breg\s+(add|delete)\b/i,
    /\bwmic\b/i,
    /\bdel\s+.*\/(s|q)(?=.*\/(q|s))/i, // aggressive recursive delete with /s /q (order-agnostic)
    /\brd\s+.*\/(s|q)(?=.*\/(q|s))/i
  ];
  const OS_RISKY = [
    /\bcopy(\.exe)?\b/i, /\bmove(\.exe)?\b/i, /\brename\b/i, /\bren\b/i,
    /\bdel\b(?!.*\/(s|q).*\/(q|s))/i, /\brd\b(?!.*\/(s|q).*\/(q|s))/i,
    /\bsc\s+stop\b/i, /\bnet\s+stop\b/i, /taskkill(\.exe)?\b/i
  ];
  const OS_SAFE = [
    /\bdir\b/i, /\btype\b/i, /\becho\b/i, /\bwhoami\b/i, /\bver\b/i,
    /\bping\b/i, /ipconfig\b/i, /systeminfo\b/i
  ];

  if(!merged){
    let learned: RegExp[] = [];
    try{ learned = loadLearnedPatterns().map(p=> new RegExp(p,'i')); }catch{}
    merged = { safe: [...SAFE, ...learned], risky: RISKY, blocked: BLOCKED };
  }
  // OS classification precedence before generic patterns
  for(const rx of OS_BLOCKED){ if(rx.test(command)) return { level:'CRITICAL', risk:'CRITICAL', category:'OS_DESTRUCTIVE', reason:`Blocked OS pattern: ${rx.source}`, blocked:true, requiresPrompt:false }; }
  for(const rx of OS_RISKY){ if(rx.test(command)) return { level:'RISKY', risk:'MEDIUM', category:'OS_MUTATION', reason:`Risky OS pattern: ${rx.source}`, blocked:false, requiresPrompt:true }; }
  for(const rx of OS_SAFE){ if(rx.test(command)) return { level:'SAFE', risk:'LOW', category:'OS_READONLY', reason:`Safe OS pattern: ${rx.source}`, blocked:false, requiresPrompt:false }; }
  for(const rx of merged.blocked){ if(rx.test(command)){
    const isGit = /git\s+/i.test(command) || /gh\s+/i.test(command);
    const cat = isGit? 'VCS_DESTRUCTIVE' : 'SECURITY_THREAT';
    return { level:'CRITICAL', risk:'CRITICAL', category:cat, reason:`Blocked pattern: ${rx.source}`, blocked:true, requiresPrompt:false };
  }}
  for(const rx of merged.risky){ if(rx.test(command)){
    const isGit = /git\s+/i.test(command) || /gh\s+/i.test(command);
    const cat = isGit? 'VCS_MUTATION' : 'FILE_OPERATION';
    return { level:'RISKY', risk:'MEDIUM', category:cat, reason:`Risky pattern: ${rx.source}`, blocked:false, requiresPrompt:true };
  }}
  for(const rx of merged.safe){ if(rx.test(command)){
    const isGit = /git\s+/i.test(command) || /gh\s+/i.test(command);
    const cat = isGit? 'VCS_READONLY' : 'INFORMATION_GATHERING';
    return { level:'SAFE', risk:'LOW', category:cat, reason:`Safe pattern: ${rx.source}`, blocked:false, requiresPrompt:false };
  }}
  // Unknown -> emit metrics
  try { metricsHttpServer.publishExecution({ id:`unk-${Date.now()}`, level:'UNKNOWN', durationMs:0, blocked:false, truncated:false, timestamp:new Date().toISOString(), preview: command.substring(0,120)+' [UNKNOWN]', success:false, exitCode:null }); metricsRegistry.record({ level:'UNKNOWN' as any, blocked:false, durationMs:0, truncated:false }); } catch {}
  auditLog('WARNING','UNKNOWN_COMMAND','Unclassified command', { preview: command.substring(0,120) });
  return { level:'UNKNOWN', risk:'MEDIUM', category:'UNKNOWN_COMMAND', reason:'Unclassified command requires confirmation', blocked:false, requiresPrompt:true };
}
