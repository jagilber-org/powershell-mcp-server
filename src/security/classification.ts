// Minimal standalone classification used by runPowerShell tool (legacy baseline)
// Augmented with parameter-aware shadow analysis (see parameterFactors.ts) to enrich recommendations.
export type SecurityLevel = 'SAFE'|'RISKY'|'CRITICAL'|'UNKNOWN'|'BLOCKED'|'DANGEROUS';
export interface SecurityAssessment { level: SecurityLevel; risk:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; category:string; reason:string; blocked:boolean; requiresPrompt:boolean; patterns?:string[]; recommendations?:string[]; }

import { assessParameters } from './parameterFactors.js';

function assess(level:SecurityLevel, opts:Partial<SecurityAssessment>):SecurityAssessment {
  const riskMap:Record<string,SecurityAssessment['risk']>={ SAFE:'LOW', RISKY:'MEDIUM', UNKNOWN:'MEDIUM', CRITICAL:'CRITICAL', BLOCKED:'CRITICAL' };
  return { level, risk: opts.risk||riskMap[level], category: opts.category||'GENERAL', reason: opts.reason||'classified', blocked: !!opts.blocked, requiresPrompt: !!opts.requiresPrompt, patterns: opts.patterns||[], recommendations: opts.recommendations||[] };
}

// Core classification used by standalone tool (simplified) – server has richer logic.
export function classifyCommandSafety(command:string): SecurityAssessment {
  const c = command.trim();
  let paramShadow: any = null;
  try { paramShadow = assessParameters(command); } catch { /* ignore shadow errors */ }
  const attach = (base:SecurityAssessment): SecurityAssessment => {
    if(paramShadow){
      base.recommendations = [...(base.recommendations||[]), ...paramShadow.suggestions];
      (base as any).parameterAware = paramShadow;
    }
    return base;
  };
  // Expanded safe coverage (feedback: too many UNKNOWN for benign Get-* commands)
  if(/^get-date\b/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Get-Date', patterns:['Get-Date'] }));
  if(/^get-process\b/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Get-Process', patterns:['Get-Process'] }));
  if(/^get-service\b/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Get-Service', patterns:['Get-Service'] }));
  if(/^get-childitem\b|^get-item\b/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'File system listing', patterns:['Get-ChildItem','Get-Item'] }));
  if(/^get-content\b/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Get-Content', patterns:['Get-Content'] }));
  if(/^get-command\b|^get-module\b|^get-alias\b|^get-variable\b|^get-location\b|^get-history\b/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Metadata inspection', patterns:['Get-*'] }));
  if(/^dir\b|^ls\b|get-childitem/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Directory listing', patterns:['dir|ls'] }));
  if(/^write-output\b/i.test(c)) return attach(assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Write-Output' }));
  // Disk / volume destructive operations (feedback gap #1)
  if(/format-volume|format\s+disk|clear-disk|remove-partition/i.test(c)) return attach(assess('CRITICAL',{ category:'DISK_DESTRUCTIVE', reason:'Disk or volume formatting command', blocked:true, patterns:['format-volume','format disk','clear-disk','remove-partition'], recommendations:['Avoid destructive disk operations'] }));
  // Registry operations (feedback gap #2)
  if(/new-item\s+-path\s+HK|remove-itemproperty|set-itemproperty/i.test(c)) return attach(assess('RISKY',{ category:'REGISTRY_OPERATION', reason:'Registry modification', requiresPrompt:true, patterns:['registry'] }));
  // Service management (feedback gap #3)
  if(/stop-service|restart-service|start-service|set-service/i.test(c)) return attach(assess('RISKY',{ category:'SERVICE_MANAGEMENT', reason:'Service management command', requiresPrompt:true, patterns:['service'] }));
  // Network operations (feedback gap #4)
  if(/invoke-webrequest|invoke-restmethod|curl\s+http|wget\s+http/i.test(c)) return attach(assess('RISKY',{ category:'NETWORK_OPERATION', reason:'Network data transfer', requiresPrompt:true, patterns:['Invoke-WebRequest','Invoke-RestMethod','curl http','wget http'] }));
  // Git operations (classification only, no git tools exposed)
  if(/^git\s+status(\s|$)/i.test(c)) return attach(assess('SAFE',{ category:'VCS_READONLY', reason:'Git status (read-only)', patterns:['git status'] }));
  if(/^git\s+diff(\s|$)/i.test(c)) return attach(assess('SAFE',{ category:'VCS_READONLY', reason:'Git diff (read-only)', patterns:['git diff'] }));
  if(/^git\s+log(\s|$)/i.test(c)) return attach(assess('SAFE',{ category:'VCS_READONLY', reason:'Git log (read-only)', patterns:['git log'] }));
  if(/^git\s+push\s+--force(\s|$)/i.test(c)) return attach(assess('CRITICAL',{ category:'VCS_MODIFICATION', reason:'Force push blocked', blocked:true, patterns:['git push --force'], recommendations:['Avoid force push; use --force-with-lease'] }));
  if(/^git\s+(commit|push|pull|merge|rebase|cherry-pick|reset)\b/i.test(c)) return attach(assess('RISKY',{ category:'VCS_MODIFICATION', reason:'Git repository modification requires confirmed:true', requiresPrompt:true, patterns:['git modify'] }));
  // Explicitly block Invoke-Expression (iex) usage for safety
  if(/invoke-expression|\biex\b/i.test(c)) return attach(assess('CRITICAL',{ category:'SECURITY_THREAT', reason:'Invoke-Expression blocked', blocked:true, patterns:['Invoke-Expression','iex'] }));
  if(/^del\s+\/s\s+\/q/i.test(c) || /rm -rf/i.test(c)) return attach(assess('CRITICAL',{ category:'OS_DESTRUCTIVE', reason:'Destructive delete', blocked:true }));
  if(/^rm\b|remove-item/i.test(c)) return attach(assess('RISKY',{ category:'FILE_OPERATION', reason:'File removal requires confirmed:true', requiresPrompt:true }));
  return attach(assess('UNKNOWN',{ category:'UNKNOWN_COMMAND', reason:'Unclassified command requires confirmed:true', requiresPrompt:true }));
}
