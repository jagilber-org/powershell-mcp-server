// Minimal standalone classification used by runPowerShell tool
export type SecurityLevel = 'SAFE'|'RISKY'|'CRITICAL'|'UNKNOWN'|'BLOCKED'|'DANGEROUS';
export interface SecurityAssessment { level: SecurityLevel; risk:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; category:string; reason:string; blocked:boolean; requiresPrompt:boolean; patterns?:string[]; recommendations?:string[]; }

function assess(level:SecurityLevel, opts:Partial<SecurityAssessment>):SecurityAssessment {
  const riskMap:Record<string,SecurityAssessment['risk']>={ SAFE:'LOW', RISKY:'MEDIUM', UNKNOWN:'MEDIUM', CRITICAL:'CRITICAL', BLOCKED:'CRITICAL' };
  return { level, risk: opts.risk||riskMap[level], category: opts.category||'GENERAL', reason: opts.reason||'classified', blocked: !!opts.blocked, requiresPrompt: !!opts.requiresPrompt, patterns: opts.patterns||[], recommendations: opts.recommendations||[] };
}

// Core classification used by standalone tool (simplified) – server has richer logic.
export function classifyCommandSafety(command:string): SecurityAssessment {
  const c = command.trim();
  if(/^dir\b|^ls\b|get-childitem/i.test(c)) return assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Directory listing', patterns:['dir|ls'] });
  if(/^write-output\b/i.test(c)) return assess('SAFE',{ category:'INFORMATION_GATHERING', reason:'Write-Output' });
  if(/git\s+status/i.test(c)) return assess('SAFE',{ category:'VCS_READONLY', reason:'git status' });
  // Disk / volume destructive operations (feedback gap #1)
  if(/format-volume|format\s+disk|clear-disk|remove-partition/i.test(c)) return assess('CRITICAL',{ category:'DISK_DESTRUCTIVE', reason:'Disk or volume formatting command', blocked:true, patterns:['format-volume','format disk','clear-disk','remove-partition'], recommendations:['Avoid destructive disk operations'] });
  // Registry operations (feedback gap #2)
  if(/new-item\s+-path\s+HK|remove-itemproperty|set-itemproperty/i.test(c)) return assess('RISKY',{ category:'REGISTRY_OPERATION', reason:'Registry modification', requiresPrompt:true, patterns:['registry'] });
  // Service management (feedback gap #3)
  if(/stop-service|restart-service|start-service|set-service/i.test(c)) return assess('RISKY',{ category:'SERVICE_MANAGEMENT', reason:'Service management command', requiresPrompt:true, patterns:['service'] });
  // Network operations (feedback gap #4)
  if(/invoke-webrequest|invoke-restmethod|curl\s+http|wget\s+http/i.test(c)) return assess('RISKY',{ category:'NETWORK_OPERATION', reason:'Network data transfer', requiresPrompt:true, patterns:['Invoke-WebRequest','Invoke-RestMethod','curl http','wget http'] });
  // Explicitly block Invoke-Expression (iex) usage for safety
  if(/invoke-expression|\biex\b/i.test(c)) return assess('CRITICAL',{ category:'SECURITY_THREAT', reason:'Invoke-Expression blocked', blocked:true, patterns:['Invoke-Expression','iex'] });
  if(/git\s+push\s+--force/i.test(c)) return assess('CRITICAL',{ category:'VCS_DESTRUCTIVE', reason:'Force push blocked', blocked:true });
  if(/git\s+commit/i.test(c)) return assess('RISKY',{ category:'VCS_MUTATION', reason:'git commit needs confirmation', requiresPrompt:true });
  if(/^del\s+\/s\s+\/q/i.test(c) || /rm -rf/i.test(c)) return assess('CRITICAL',{ category:'OS_DESTRUCTIVE', reason:'Destructive delete', blocked:true });
  if(/^rm\b|remove-item/i.test(c)) return assess('RISKY',{ category:'FILE_OPERATION', reason:'File removal requires confirmation', requiresPrompt:true });
  return assess('UNKNOWN',{ category:'UNKNOWN_COMMAND', reason:'Unclassified command requires confirmation', requiresPrompt:true });
}
