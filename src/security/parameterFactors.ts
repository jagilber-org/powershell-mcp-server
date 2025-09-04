// Parameter-aware, lightweight risk factor engine (shadow mode)
// Focus: minimal regex/tokenization, no external deps, <1ms typical.
// Produces a proposed classification WITHOUT altering existing gating yet.

export type SecurityLevel = 'SAFE'|'RISKY'|'DANGEROUS'|'CRITICAL'|'UNKNOWN'|'BLOCKED';

export interface RiskFactor { name:string; delta:number; note?:string; }
export interface CommandFactorSummary { command:string; score:number; factors:RiskFactor[]; simulation:boolean; }
export interface ParameterAwareAssessment {
  rawScore:number;              // Sum BEFORE mitigations
  adjustedScore:number;         // After mitigations
  factors:RiskFactor[];         // Aggregated (flattened) factors
  perCommand:CommandFactorSummary[];
  simulation:boolean;           // True if any -WhatIf present on modifiable verbs and no -Force override
  suggestions:string[];         // Plain language recommendations
  proposedLevel:SecurityLevel;  // Suggested (shadow) security level
  engineVersion:string;         // For cache invalidation / telemetry
}

const ENGINE_VERSION = 'pa-1.0.0';
// Tracing: controlled by env POWER_SHELL_MCP_TRACE_FACTORS=1
function trace(event:string, data:any){
  if(process.env.POWER_SHELL_MCP_TRACE_FACTORS==='1'){
    try { console.error(`[PARAM_FACTORS][${event}]`, JSON.stringify(data)); } catch { /* ignore */ }
  }
}

// Scoring thresholds (inclusive ranges)
function levelFromScore(score:number): SecurityLevel {
  if(score <= 1) return 'SAFE';
  if(score <= 3) return 'RISKY';
  if(score <= 5) return 'DANGEROUS';
  if(score <= 7) return 'CRITICAL';
  return 'CRITICAL'; // >=8
}

const MOD_VERBS = /^(set|add|new|remove|clear|stop|restart|start|enable|disable|invoke|import|export|connect|send|receive|copy|move|rename|install|uninstall|write|out)-/i;
const DESTRUCTIVE_VERBS = /^(remove|clear|stop|restart|uninstall|invoke)-/i;
const HIGH_RISK_CMDS = /(invoke-expression|iex\b|set-executionpolicy|format-volume|clear-disk|remove-partition)/i;
const DOWNLOAD_EXEC = /(iwr|wget|curl).*\|.*(iex|invoke-expression)/i;
const EXEC_POLICY_BYPASS = /-executionpolicy\s+bypass/i;

// Path / target sensitivity
const CRITICAL_PATH = /(^|\s)(?:C:\\Windows|C:\\Program Files|C:\\ProgramData|HKLM:|HKCU:|HKLM\\|HKCU\\)/i;
const UNC_PATH = /\\\\[A-Za-z0-9_.-]+\\[A-Za-z0-9$. _-]+/;

// Fast tokenize by splitting on ; and newlines but keep pipelines within a single segment (we still evaluate entire segment).
function splitSegments(command:string): string[] { return command.split(/[;\n]+/).map(s=>s.trim()).filter(Boolean); }

// Extract simple flag/param names ( -Force, -Recurse, -WhatIf, -Confirm, -Confirm:$false etc.)
function extractParams(segment:string): string[]{
  const params = new Set<string>();
  const rx = /( -{1,2}[A-Za-z][A-Za-z0-9:-]*)(?=\s|$)/g; // simplistic flag grabber
  let m:RegExpExecArray|null;
  while((m = rx.exec(segment))){ params.add(m[1].trim()); }
  return Array.from(params);
}

interface ScoreCtx { raw:number; adjusted:number; factors:RiskFactor[]; simulation:boolean; }

function scoreSegment(seg:string): CommandFactorSummary {
  const lower = seg.toLowerCase();
  const params = extractParams(seg);
  const factors:RiskFactor[] = [];
  let raw = 0; let adjusted = 0; let simulation = false;
  const firstToken = seg.trim().split(/\s+|\|/)[0];

  const verbMatch = /^([A-Za-z]+)-/.exec(firstToken);
  const verb = verbMatch ? verbMatch[1].toLowerCase() : '';
  const modVerb = MOD_VERBS.test(firstToken);
  const destructiveVerb = DESTRUCTIVE_VERBS.test(firstToken);

  // Critical / high patterns
  if(HIGH_RISK_CMDS.test(lower)){
    factors.push({ name:'HighRiskCommand', delta:3, note:'Explicit high-risk cmdlet' }); raw += 3; adjusted += 3;
  }
  if(DOWNLOAD_EXEC.test(lower)){
    factors.push({ name:'DownloadAndExecute', delta:3, note:'Pipeline download -> execute' }); raw += 3; adjusted += 3;
  }
  if(EXEC_POLICY_BYPASS.test(lower)){
    factors.push({ name:'ExecPolicyBypass', delta:3, note:'ExecutionPolicy bypass' }); raw += 3; adjusted += 3;
  }

  // Verb-based baseline increases for destructive/mod verbs
  if(modVerb){ factors.push({ name:'ModifyingVerb', delta:1, note:verb }); raw += 1; adjusted += 1; }
  if(destructiveVerb){ factors.push({ name:'DestructiveVerb', delta:1, note:verb }); raw += 1; adjusted += 1; }

  // Parameter amplifiers
  if(params.some(p=> /-Force/i.test(p))){ factors.push({ name:'Force', delta:2 }); raw += 2; adjusted += 2; }
  if(params.some(p=> /-Recurse/i.test(p))){ factors.push({ name:'Recurse', delta:2 }); raw += 2; adjusted += 2; }
  if(params.some(p=> /-AsJob/i.test(p))){ factors.push({ name:'AsJob', delta:1 }); raw += 1; adjusted += 1; }
  if(params.some(p=> /-Confirm:\$false/i.test(p))){ factors.push({ name:'ConfirmFalse', delta:2, note:'Bypasses confirmation' }); raw += 2; adjusted += 2; }

  // Path / target based
  if(CRITICAL_PATH.test(seg)){ factors.push({ name:'CriticalPath', delta:2 }); raw += 2; adjusted += 2; }
  if(UNC_PATH.test(seg) && /(export-|out-file|set-content|add-content|copy-item|move-item)/i.test(seg)){
    factors.push({ name:'UNCWrite', delta:2, note:'Potential exfiltration' }); raw += 2; adjusted += 2; }

  // Mitigations (-WhatIf, -Confirm w/out :$false)
  const hasWhatIf = params.some(p=> /-WhatIf/i.test(p));
  const hasForce = params.some(p=> /-Force/i.test(p));
  if(hasWhatIf && !hasForce && modVerb){ factors.push({ name:'WhatIfMitigation', delta:-2 }); adjusted -= 2; simulation = true; }
  if(params.some(p=> /^-Confirm$/i.test(p))){ factors.push({ name:'ConfirmMitigation', delta:-1 }); adjusted -= 1; }

  // Escalation: -Confirm:$false combined with -Force or destructive verb
  if(params.some(p=> /-Confirm:\$false/i.test(p)) && (hasForce || destructiveVerb)){
    factors.push({ name:'BypassConfirmationEscalation', delta:2 }); raw += 2; adjusted += 2; }

  return { command: seg, score: adjusted, factors, simulation };
}

export function assessParameters(command:string): ParameterAwareAssessment | null {
  if(!command || !command.trim()) return null;
  try {
    const segments = splitSegments(command);
    trace('segments', { count: segments.length });
    const per: CommandFactorSummary[] = [];
    let rawTotal=0; let adjustedTotal=0; let anySimulation=false; const aggregate:RiskFactor[] = [];
    for(const seg of segments){
      const scored = scoreSegment(seg);
      trace('segmentScore', { seg: seg.slice(0,120), score: scored.score });
      per.push(scored);
      rawTotal += Math.max(0, scored.factors.filter(f=>f.delta>0).reduce((a,b)=>a+b.delta,0));
      adjustedTotal += scored.score;
      if(scored.simulation) anySimulation = true;
      for(const f of scored.factors){ aggregate.push(f); }
    }
    // Bound scores (avoid negative net below 0)
    if(adjustedTotal < 0) adjustedTotal = 0;
    const level = levelFromScore(adjustedTotal);
    // Suggestions
    const suggestions:string[] = [];
    if(aggregate.some(f=>f.name==='Force') && !aggregate.some(f=>f.name==='WhatIfMitigation')) suggestions.push('Add -WhatIf for preview instead of using -Force directly');
    if(aggregate.some(f=>f.name==='ConfirmFalse')) suggestions.push('Remove -Confirm:$false to retain confirmation safeguards');
    if(level !== 'SAFE' && !anySimulation && !aggregate.some(f=>f.name==='WhatIfMitigation') && segments.length === 1) suggestions.push('Consider adding -WhatIf to simulate changes');
  const result = { rawScore: rawTotal, adjustedScore: adjustedTotal, factors: aggregate, perCommand: per, simulation: anySimulation, suggestions, proposedLevel: level, engineVersion: ENGINE_VERSION };
  trace('result', { adjusted: adjustedTotal, proposedLevel: level, simulation: anySimulation });
  return result;
  } catch {
    return null;
  }
}
