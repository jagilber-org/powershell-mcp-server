// Unified run-powershell tool implementation extracted from server
import { classifyCommandSafety } from '../security/classification.js';
import { auditLog } from '../logging/audit.js';
import { ENTERPRISE_CONFIG } from '../core/config.js';
import { detectShell } from '../core/shellDetection.js';
import { metricsRegistry } from '../metrics/registry.js';
import { metricsHttpServer } from '../metrics/httpServer.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectShell } from '../core/shellDetection.js';

async function killProcessTreeWindows(pid: number): Promise<{ ok: boolean; stdout: string; stderr: string }>{
  return new Promise(resolve=>{
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F']);
    let kStdout=''; let kStderr='';
    killer.stdout.on('data', d=> kStdout += d.toString());
    killer.stderr.on('data', d=> kStderr += d.toString());
    killer.on('close', code=> resolve({ ok: code===0, stdout: kStdout.trim(), stderr: kStderr.trim() }));
  });
}

interface AdaptiveConfig {
<<<<<<< HEAD
  enabled: boolean;
  extendWindowMs: number;
  extendStepMs: number;
  maxTotalMs: number;
=======
  enabled: boolean;              // whether adaptive extension is enabled
  extendWindowMs: number;        // window inside which we consider extending
  extendStepMs: number;          // amount to extend per step
  maxTotalMs: number;            // hard cap on external timeout
  progressAdaptive?: boolean;    // metadata flag
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
}

export async function executePowerShell(command: string, timeout: number, workingDirectory?: string, opts?: { internalTimerMs?: number; adaptive?: AdaptiveConfig }){
  const start = Date.now();
  const debugAdaptive = !!process.env.MCP_DEBUG_ADAPTIVE;
  const adaptive = opts?.adaptive && opts.adaptive.enabled ? opts.adaptive : undefined;
  if(debugAdaptive){ process.stderr.write(`[ADAPTIVE DEBUG] executePowerShell entry base=${timeout} adaptive=${!!adaptive}\n`); }
  // Working directory
  let resolvedCwd: string | undefined;
  if(workingDirectory){
<<<<<<< HEAD
    try { resolvedCwd = fs.realpathSync(workingDirectory); } catch { throw new McpError(ErrorCode.InvalidRequest, 'Working directory not found'); }
=======
    try { resolvedCwd = fs.realpathSync(workingDirectory); } catch { throw new McpError(ErrorCode.InvalidRequest,'Working directory not found'); }
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
    if(ENTERPRISE_CONFIG.security.enforceWorkingDirectory){
      const allowed = ENTERPRISE_CONFIG.security.allowedWriteRoots.some((root:string)=>{
        const resolvedRoot = path.resolve(root.replace('${TEMP}', os.tmpdir()));
        return resolvedCwd!.startsWith(resolvedRoot);
      });
      if(!allowed) throw new McpError(ErrorCode.InvalidRequest,'Working directory outside allowed roots');
    }
  }
<<<<<<< HEAD

  const { exe: shellExe, source: shellSource, tried: shellTried } = detectShell();

  const lead = ENTERPRISE_CONFIG.limits.internalSelfDestructLeadMs || 300;
  const adaptive = opts?.adaptive && opts.adaptive.enabled ? opts.adaptive : undefined;
  const internalMs = opts?.internalTimerMs ? Math.max(100, opts.internalTimerMs - lead) : Math.max(100, ((adaptive ? adaptive.maxTotalMs : timeout) - lead));
  const injected = `[System.Threading.Timer]::new({[Environment]::Exit(124)}, $null, ${internalMs}, 0)|Out-Null; $ProgressPreference='SilentlyContinue'; Set-StrictMode -Version Latest; ${command}`;
=======
  // Shell + injected timer
  const shellInfo = detectShell();
  const shellExe = shellInfo.shellExe || 'powershell.exe';
  const lead = ENTERPRISE_CONFIG.limits.internalSelfDestructLeadMs || 300;
  const internalTarget = adaptive ? (adaptive.maxTotalMs || timeout) : timeout;
  const internalMs = Math.max(100, (opts?.internalTimerMs || internalTarget) - lead);
  // Optional per-process metrics capture flag
  const capturePsMetrics = process.env.MCP_CAPTURE_PS_METRICS === '1';
  // We capture a single snapshot at end via a trailing marker that the parent parses (stdout)
  // Simpler than periodic sampling and sufficient for aggregate averages.
  const metricsTrailer = capturePsMetrics ? ';$proc=[System.Diagnostics.Process]::GetCurrentProcess(); $ci=[System.Globalization.CultureInfo]::InvariantCulture; $cpu=([Math]::Round($proc.TotalProcessorTime.TotalSeconds,4)).ToString($ci); $ws=([Math]::Round($proc.WorkingSet64/1MB,2)).ToString($ci); $m="__MCP_PSMETRICS__$cpu,$ws"; [Console]::Error.WriteLine($m); Write-Output $m' : '';
  const injected = `[System.Threading.Timer]::new({[Environment]::Exit(124)}, $null, ${internalMs}, 0)|Out-Null; $ProgressPreference='SilentlyContinue'; Set-StrictMode -Version Latest; ${command}${metricsTrailer}`;
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
  const child = spawn(shellExe, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', injected], { windowsHide:true, cwd: resolvedCwd });
  // Streaming
  let stdout=''; let stderr='';
  const stdoutChunks: { seq:number; text:string; bytes:number }[]=[];
  const stderrChunks: { seq:number; text:string; bytes:number }[]=[];
  const chunkBytes = (ENTERPRISE_CONFIG.limits.chunkKB || 64)*1024;
  const maxTotalBytes = (ENTERPRISE_CONFIG.limits.maxOutputKB || 512)*1024;
<<<<<<< HEAD
  let totalBytes=0; let overflow=false;
  let timedOut=false; let killEscalated=false; let killTreeAttempted=false; let killTreeResult: any = null; let watchdogTriggered=false; let resolved=false;
    const graceAfterSignal = 1500; // ms to wait after first TERM
    const hardKillTotal = (adaptive ? adaptive.maxTotalMs : timeout) + graceAfterSignal + 2000; // absolute deadline for watchdog (ms)

  let lastActivity = Date.now();
  const adaptiveLog: any[] = [];
  const handleData = (buf:Buffer, isErr:boolean)=>{
    if(overflow) return;
    const str = buf.toString('utf8');
    if(isErr) stderr += str; else stdout += str;
    lastActivity = Date.now();
    const target = isErr? stderr: stdout;
    if(Buffer.byteLength(target,'utf8') >= chunkBytes){
      const text = isErr? stderr: stdout;
      const bytes = Buffer.byteLength(text,'utf8');
      const chunk = { seq: isErr? stderrChunks.length: stdoutChunks.length, text, bytes };
      (isErr? stderrChunks: stdoutChunks).push(chunk);
      totalBytes += bytes;
      if(isErr) stderr=''; else stdout='';
    }
    if(totalBytes > maxTotalBytes){
      overflow=true;
      try{ child.kill('SIGTERM'); }catch{}
      if(ENTERPRISE_CONFIG.limits.hardKillOnOverflow){ setTimeout(()=>{ try{ child.kill('SIGKILL'); }catch{} }, 500); }
    }
  };
  child.stdout.on('data', d=> handleData(d as Buffer,false));
  child.stderr.on('data', d=> handleData(d as Buffer,true));

  let terminationReason: 'timeout'|'overflow'|'killed'|'completed'|undefined;

  const finish = (exitCode: number|null)=>{
    if(resolved) return; resolved=true; clearTimeout(timeoutHandle); clearTimeout(watchdogHandle);
    const duration = Date.now()-start;
    const flushBuf = (text:string, isErr:boolean)=>{
      if(!text) return; const bytes = Buffer.byteLength(text,'utf8');
      const arr = isErr? stderrChunks: stdoutChunks;
      arr.push({ seq: arr.length, text, bytes }); totalBytes += bytes;
    };
    flushBuf(stdout,false); flushBuf(stderr,true);
    if(exitCode === 124 && !timedOut){ timedOut = true; }
    if(!terminationReason){
      if(timedOut) terminationReason = 'timeout';
      else if(overflow) terminationReason = 'overflow';
      else if(exitCode !== 0) terminationReason = 'killed';
      else terminationReason = 'completed';
    }
    returnResult({ success: !timedOut && exitCode===0 && !overflow, stdout: stdoutChunks.map(c=>c.text).join('').slice(0,2000), stderr: stderrChunks.map(c=>c.text).join('').slice(0,2000), exitCode, duration_ms: duration, timedOut, internalSelfDestruct: exitCode===124, configuredTimeoutMs: timeout, killEscalated, killTreeAttempted, killTreeResult, watchdogTriggered, shellExe, shellSource, shellTried, workingDirectory: resolvedCwd, chunks:{ stdout: stdoutChunks, stderr: stderrChunks }, overflow, totalBytes, terminationReason, internalTimerMs: internalMs, watchdogHardKillTotalMs: hardKillTotal });
  };

  let returnResult: (r:any)=>void; const resultPromise = new Promise<any>(res=> returnResult = res);

  const attemptProcessTreeKill = async ()=>{
    if(process.platform === 'win32' && child.pid){
      killTreeAttempted=true;
      killTreeResult = await killProcessTreeWindows(child.pid);
    }
  };

  let currentExternalTimeout = timeout;
  let adaptiveExtensions = 0;
  let extended = false;
  let firstAdaptiveDecision = true;
  const scheduleExternalTimeout = (ms:number)=> setTimeout(()=>{
    timedOut=true; terminationReason = 'timeout';
    try{ child.kill('SIGTERM'); }catch{}
    setTimeout(async ()=>{
      if(!child.killed){
        killEscalated=true; try{ child.kill('SIGKILL'); }catch{}
        const verifyUntil = Date.now() + (ENTERPRISE_CONFIG.limits.killVerifyWindowMs||1500);
        const verify = async ()=>{
          if(child.killed) return;
            if(Date.now()>verifyUntil){ if(!child.killed) await attemptProcessTreeKill(); return; }
          if(process.platform==='win32' && child.pid){
            const tl = spawn('tasklist',['/FI',`PID eq ${child.pid}`]);
            let out=''; tl.stdout.on('data',d=> out+=d.toString());
            tl.on('close', async ()=>{ if(new RegExp(`${child.pid}`).test(out)) setTimeout(verify,200); });
          } else {
            setTimeout(verify,200);
          }
        };
        setTimeout(async ()=>{ if(!child.killed) verify(); }, 200);
      }
    }, 1500);
  }, ms);
  let timeoutHandle = scheduleExternalTimeout(timeout);

  let adaptiveCheckTimer: NodeJS.Timeout | null = null;
  if(adaptive){
    const check = ()=>{
      // instrumentation log point
      const now0=Date.now();
      if(resolved || timedOut) return;
  const now = Date.now();
  const remaining = (start + currentExternalTimeout) - now;
  const elapsed = now - start;
      if(remaining <= adaptive.extendWindowMs){
        const recentActivity = (now - lastActivity) <= adaptive.extendWindowMs;
        const canExtend = (recentActivity || firstAdaptiveDecision) && (elapsed + adaptive.extendStepMs) <= adaptive.maxTotalMs;
        adaptiveLog.push({ t: elapsed, remaining, recentActivity, canExtend, extended:false, currentExternalTimeout, lastActivityDelta: now-lastActivity });
        if(canExtend){
          clearTimeout(timeoutHandle);
          currentExternalTimeout += adaptive.extendStepMs;
          timeoutHandle = scheduleExternalTimeout(currentExternalTimeout - elapsed);
          adaptiveExtensions += 1; extended = true; firstAdaptiveDecision = false;
          adaptiveLog.push({ t: elapsed, action:'extended', newExternalTimeout: currentExternalTimeout });
        }
      } else {
        adaptiveLog.push({ t: elapsed, remaining, skipped:true });
      }
      if(!resolved && !timedOut && (Date.now()-start) < adaptive.maxTotalMs){
        adaptiveCheckTimer = setTimeout(check, Math.min( adaptive.extendWindowMs/2, 1000));
      }
    };
    check();
    adaptiveCheckTimer = setTimeout(check, Math.min(adaptive.extendWindowMs/2, 1000));
  }

  const watchdogHandle = setTimeout(async ()=>{
    if(resolved) return; watchdogTriggered=true; if(!terminationReason) terminationReason='killed';
    try{ if(child.pid) await attemptProcessTreeKill(); }catch{}
    finish(null);
  }, hardKillTotal);

  child.on('error', _e=>{ /* captured elsewhere */ });
  child.on('close', code=> finish(code));

  return resultPromise.then(r=> ({ ...r, effectiveTimeoutMs: currentExternalTimeout, adaptiveExtensions, adaptiveExtended: extended, adaptiveMaxTotalMs: adaptive?.maxTotalMs, adaptiveLog, lastActivityDeltaMs: lastActivity - start }));
=======
  let totalBytes=0; let overflow=false; let resolved=false; let timedOut=false; let killEscalated=false; let killTreeAttempted=false; let killTreeResult:any=null; let watchdogTriggered=false;
  const graceAfterSignal = 1500; const hardKillTotal = (adaptive? adaptive.maxTotalMs: timeout) + graceAfterSignal + 2000;
  let lastActivity = Date.now();
  let psCpuSec:number|undefined; let psWSMB:number|undefined;
  const metricsRegex = /__MCP_PSMETRICS__([0-9]+[.,]?[0-9]*),([0-9]+[.,]?[0-9]*)/;
  const handleData=(buf:Buffer,isErr:boolean)=>{ if(overflow) return; const str=buf.toString('utf8');
    const scanForMetrics = (text:string)=>{
      if(!capturePsMetrics) return text;
      if(text.includes('__MCP_PSMETRICS__')){
        const m = metricsRegex.exec(text.replace(/\r?\n/g,''));
        if(m){
          try { psCpuSec = parseFloat(m[1].replace(',','.')); psWSMB = parseFloat(m[2].replace(',','.')); if(process.env.METRICS_DEBUG==='true'){ process.stderr.write(`[METRICS][CAPTURE] cpu=${psCpuSec} ws=${psWSMB} from ${isErr?'stderr':'stdout'}\n`); } } catch{}
        }
        // Strip all sentinel lines
        return text.split(/\r?\n/).filter(l=>!l.startsWith('__MCP_PSMETRICS__')).join('\n');
      }
      return text;
    };
    if(isErr){ stderr+= scanForMetrics(str); } else { stdout+= scanForMetrics(str); }
    lastActivity=Date.now(); const target=isErr?stderr:stdout; if(Buffer.byteLength(target,'utf8')>=chunkBytes){ const bytes=Buffer.byteLength(target,'utf8'); const chunk={ seq:isErr?stderrChunks.length:stdoutChunks.length, text:target, bytes }; (isErr?stderrChunks:stdoutChunks).push(chunk); totalBytes+=bytes; if(isErr) stderr=''; else stdout=''; }
    if(totalBytes>maxTotalBytes){ overflow=true; try{ child.kill('SIGTERM'); }catch{} if(ENTERPRISE_CONFIG.limits.hardKillOnOverflow) setTimeout(()=>{ try{ child.kill('SIGKILL'); }catch{} },500); } };
  child.stdout.on('data', d=> handleData(d as Buffer,false)); child.stderr.on('data', d=> handleData(d as Buffer,true));
  // Completion infrastructure
  let returnResult:(r:any)=>void; const resultPromise = new Promise<any>(res=> returnResult=res);
  const finish = (exitCode:number|null)=>{ if(resolved) return; resolved=true; if(timeoutHandle) clearTimeout(timeoutHandle); clearTimeout(watchdogHandle); const duration=Date.now()-start; const flush=(text:string,isErr:boolean)=>{ if(!text) return; const bytes=Buffer.byteLength(text,'utf8'); const arr=isErr?stderrChunks:stdoutChunks; arr.push({ seq:arr.length, text, bytes }); totalBytes+=bytes; }; flush(stdout,false); flush(stderr,true); if(exitCode===124 && !timedOut) timedOut=true; const success=!timedOut && !overflow && (exitCode===0 || exitCode===null);
    // Fallback sentinel scan: if metrics capture requested but we failed to parse in-stream (chunk split edge case)
    if(capturePsMetrics && (psCpuSec === undefined || psWSMB === undefined)){
      try {
        const scanStreams = (chunksArr:any[])=>{
          const joined = chunksArr.map(c=>c.text).join('');
          const idx = joined.lastIndexOf('__MCP_PSMETRICS__');
          if(idx !== -1){
            const tail = joined.slice(idx).split(/\r?\n/)[0];
            const m = /__MCP_PSMETRICS__([0-9]+[.,]?[0-9]*),([0-9]+[.,]?[0-9]*)/.exec(tail.replace(/\r/g,''));
            if(m){
              if(psCpuSec === undefined) psCpuSec = parseFloat(m[1].replace(',','.'));
              if(psWSMB === undefined) psWSMB = parseFloat(m[2].replace(',','.'));
              for(const ch of chunksArr){ if(ch.text.includes('__MCP_PSMETRICS__')){ ch.text = ch.text.split(/\r?\n/).filter((l:string)=>!l.startsWith('__MCP_PSMETRICS__')).join('\n'); ch.bytes = Buffer.byteLength(ch.text,'utf8'); } }
              if(process.env.METRICS_DEBUG==='true'){ process.stderr.write(`[METRICS][FALLBACK] Parsed sentinel late cpu=${psCpuSec} ws=${psWSMB} from ${(chunksArr===stdoutChunks)?'stdout':'stderr'}\n`); }
            }
          }
        };
        if(psCpuSec === undefined || psWSMB === undefined) scanStreams(stdoutChunks);
        if(psCpuSec === undefined || psWSMB === undefined) scanStreams(stderrChunks);
      } catch(err){ if(process.env.METRICS_DEBUG==='true'){ process.stderr.write(`[METRICS][FALLBACK][ERROR] ${(err as Error).message}\n`); } }
    }
    if(capturePsMetrics && process.env.METRICS_DEBUG==='true' && (psCpuSec===undefined||psWSMB===undefined)){
      const preview = stdoutChunks.map(c=>c.text).join('').slice(-400);
      process.stderr.write(`[METRICS][MISSING] Sentinel not parsed. stdoutTail=${JSON.stringify(preview)}\n`);
    }
    // If we captured only one dimension, still treat it as a sample (use 0 for missing to allow aggregation to progress)
    if(capturePsMetrics){
      if(psCpuSec === undefined && psWSMB !== undefined) psCpuSec = 0;
      if(psWSMB === undefined && psCpuSec !== undefined) psWSMB = 0;
    }
    returnResult({ success, stdout: stdoutChunks.map(c=>c.text).join('').slice(0,2000), stderr: stderrChunks.map(c=>c.text).join('').slice(0,2000), exitCode, duration_ms:duration, timedOut, internalSelfDestruct: exitCode===124, configuredTimeoutMs: timeout, killEscalated, killTreeAttempted, killTreeResult, watchdogTriggered, shellExe, workingDirectory: resolvedCwd, chunks:{ stdout:stdoutChunks, stderr:stderrChunks }, overflow, totalBytes, psCpuSec, psWSMB }); };
  const attemptProcessTreeKill = async ()=>{ if(process.platform==='win32' && child.pid){ killTreeAttempted=true; killTreeResult = await killProcessTreeWindows(child.pid); }};
  // Adaptive / timeout
  let currentExternalTimeout = timeout; let adaptiveExtensions=0; let adaptiveLog:any[]=[]; let extended=false; let timeoutHandle: NodeJS.Timeout | undefined;
  const fireTimeout = ()=>{ if(debugAdaptive){ process.stderr.write(`[ADAPTIVE DEBUG] base timeout fired elapsed=${Date.now()-start}\n`);} timedOut=true; try{ child.kill('SIGTERM'); }catch{} setTimeout(()=>{ if(!resolved){ killEscalated=true; try{ child.kill('SIGKILL'); }catch{} } }, graceAfterSignal); };
  if(!adaptive){ timeoutHandle = setTimeout(fireTimeout, timeout); }
  if(adaptive){ const interval = Math.min(Math.max(200, adaptive.extendWindowMs/3), 600); let externalDeadline = start + timeout; let graceActive=false; let graceDeadline=0; if(debugAdaptive){ process.stderr.write(`[ADAPTIVE DEBUG] monitor start base=${timeout} window=${adaptive.extendWindowMs} step=${adaptive.extendStepMs} max=${adaptive.maxTotalMs} interval=${interval}\n`);} const tick=()=>{ if(resolved||timedOut) return; const now=Date.now(); const elapsed=now-start; const remaining=externalDeadline-now; const recentActivity=(now-lastActivity)<=adaptive.extendWindowMs; const canExtend=remaining<=adaptive.extendWindowMs && recentActivity && (externalDeadline + adaptive.extendStepMs - start) <= adaptive.maxTotalMs; if(canExtend){ const prev=externalDeadline; externalDeadline += adaptive.extendStepMs; currentExternalTimeout = externalDeadline - start; adaptiveExtensions++; extended=true; graceActive=false; adaptiveLog.push({ event:'extend', prev:(prev-start), next: currentExternalTimeout, elapsed, remaining: externalDeadline - Date.now(), recentActivity }); } else if(remaining<=0){ const lastChance= recentActivity && (externalDeadline + adaptive.extendStepMs - start) <= adaptive.maxTotalMs; if(lastChance){ const prev=externalDeadline; externalDeadline += adaptive.extendStepMs; currentExternalTimeout = externalDeadline - start; adaptiveExtensions++; extended=true; graceActive=false; adaptiveLog.push({ event:'extend-late', prev:(prev-start), next: currentExternalTimeout, elapsed }); } else if(recentActivity && !graceActive){ graceActive=true; graceDeadline = now + Math.min(adaptive.extendWindowMs, adaptive.extendStepMs); adaptiveLog.push({ event:'grace', elapsed, graceMs: graceDeadline-now }); } else if(graceActive && now < graceDeadline){ adaptiveLog.push({ event:'grace-wait', elapsed, remainingGrace: graceDeadline-now }); } else { timedOut=true; adaptiveLog.push({ event:'timeout', elapsed, lastActivityDelta: now-lastActivity, graceUsed: graceActive }); try{ child.kill('SIGTERM'); }catch{} setTimeout(()=>{ if(!resolved){ try{ child.kill('SIGKILL'); }catch{} } }, graceAfterSignal); return; } } else { adaptiveLog.push({ event:'monitor', elapsed, remaining, recentActivity }); } if(!resolved && !timedOut && (Date.now()-start) < adaptive.maxTotalMs + adaptive.extendStepMs){ setTimeout(tick, interval); } }; setTimeout(tick, interval); }
  // Watchdog
  const watchdogHandle = setTimeout(async ()=>{ if(resolved) return; watchdogTriggered=true; try{ if(child.pid) await attemptProcessTreeKill(); }catch{} finish(null); }, hardKillTotal);
  child.on('error', ()=>{}); child.on('close', code=> finish(code)); child.on('exit', code=> finish(code));
  return resultPromise.then(r=> ({ ...r, effectiveTimeoutMs: currentExternalTimeout, adaptiveExtensions, adaptiveExtended: extended, adaptiveMaxTotalMs: adaptive?.maxTotalMs, adaptiveLog, psCpuSec, psWSMB }));
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
}

export async function runPowerShellTool(args: any){
  const command = args.command || args.script;
  if(!command) throw new McpError(ErrorCode.InvalidParams, 'command or script required');
  const maxChars = ENTERPRISE_CONFIG.limits.maxCommandChars || 10000;
  if(command.length > maxChars){
    throw new McpError(ErrorCode.InvalidRequest, `Command length ${command.length} exceeds limit ${maxChars}`);
  }
  const assessment = classifyCommandSafety(command);
  if(assessment.blocked){
    auditLog('WARNING','BLOCKED_COMMAND','Blocked by security policy',{ reason: assessment.reason, patterns: assessment.patterns, level: assessment.level });
    return { content:[{ type:'text', text: 'Blocked: '+assessment.reason }], structuredContent:{ success:false, blocked:true, securityAssessment: assessment, exitCode: null } };
  }
  if(assessment.requiresPrompt && !args.confirmed) {
    throw new McpError(ErrorCode.InvalidRequest, 'Confirmation required: '+assessment.reason);
  }
<<<<<<< HEAD
  let timeoutSeconds = args.aiAgentTimeoutSec || args.aiAgentTimeout || args.timeout;
  const warnings: string[] = [];
  const MAX_TIMEOUT_SECONDS = ENTERPRISE_CONFIG.limits?.maxTimeoutSeconds ?? 600;
  const usedLegacy = (!!args.aiAgentTimeout && !args.aiAgentTimeoutSec);
  const usedGeneric = (!!args.timeout && !args.aiAgentTimeoutSec && !args.aiAgentTimeout);
  if(usedLegacy){ warnings.push("Parameter 'aiAgentTimeout' is deprecated; use 'aiAgentTimeoutSec' (seconds)." ); }
  if(usedGeneric){ warnings.push("Parameter 'timeout' is deprecated; use 'aiAgentTimeoutSec' (seconds)." ); }
  if(typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0){
    timeoutSeconds = (ENTERPRISE_CONFIG.limits.defaultTimeoutMs || 90000) / 1000;
  }
  if(timeoutSeconds > MAX_TIMEOUT_SECONDS){ throw new McpError(ErrorCode.InvalidParams, 'Timeout '+timeoutSeconds+'s exceeds max allowed '+MAX_TIMEOUT_SECONDS+'s'); }
  if(timeoutSeconds >= 60){ warnings.push('Long timeout '+timeoutSeconds+'s may reduce responsiveness.'); }
  const timeout = Math.round(timeoutSeconds * 1000);
  const adaptiveEnabled = !!args.adaptiveTimeout || !!args.progressAdaptive;
  let adaptiveConfig: AdaptiveConfig | undefined = undefined;
  if(adaptiveEnabled){
    const maxTotalSec = args.adaptiveMaxTotalSec || args.adaptiveMaxSec || Math.min(timeoutSeconds*3, 180);
=======
  // Timeout is always interpreted as seconds (agent contract) then converted to ms; default config already in ms
  // Accept multiple alias parameter names for timeout in SECONDS (new canonical: aiAgentTimeoutSec)
  let timeoutSeconds = args.aiAgentTimeoutSec || args.aiAgentTimeout || args.timeoutSeconds || args.timeout;
const warnings: string[] = [];
const MAX_TIMEOUT_SECONDS = ENTERPRISE_CONFIG.limits?.maxTimeoutSeconds ?? 600;
const usedLegacy = (!!args.aiAgentTimeout && !args.aiAgentTimeoutSec);
const usedGeneric = (!!args.timeout && !args.aiAgentTimeoutSec && !args.aiAgentTimeout && !args.timeoutSeconds);
// Provide guidance if user used 'timeoutSeconds' (acceptable neutral alias) but not canonical field
if(args.timeoutSeconds && !args.aiAgentTimeoutSec){ warnings.push("Parameter 'timeoutSeconds' is accepted but prefer 'aiAgentTimeoutSec' for clarity."); }
if(usedLegacy){ warnings.push("Parameter 'aiAgentTimeout' is deprecated; use 'aiAgentTimeoutSec' (seconds)." ); }
if(usedGeneric){ warnings.push("Parameter 'timeout' is deprecated; use 'aiAgentTimeoutSec' (seconds)." ); }
if(typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0){
  timeoutSeconds = (ENTERPRISE_CONFIG.limits.defaultTimeoutMs || 90000) / 1000;
}
if(timeoutSeconds > MAX_TIMEOUT_SECONDS){ throw new McpError(ErrorCode.InvalidParams, 'Timeout '+timeoutSeconds+'s exceeds max allowed '+MAX_TIMEOUT_SECONDS+'s'); }
if(timeoutSeconds >= 60){
  // Maintain phrase 'long timeout' for test assertions
  warnings.push(`Long timeout ${timeoutSeconds}s may reduce responsiveness.`);
}
const timeout = Math.round(timeoutSeconds * 1000);
  // Adaptive timeout configuration
  const adaptiveEnabled = !!args.adaptiveTimeout || !!args.progressAdaptive;
  let adaptiveConfig: AdaptiveConfig | undefined = undefined;
  if(adaptiveEnabled){
  const maxTotalSec = args.adaptiveMaxTotalSec || args.adaptiveMaxSec || Math.min(timeoutSeconds*3, 180); // cap 3x or 180s
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
    adaptiveConfig = {
      enabled: true,
      extendWindowMs: (args.adaptiveExtendWindowMs || 2000),
      extendStepMs: (args.adaptiveExtendStepMs || 5000),
  maxTotalMs: Math.round(maxTotalSec*1000),
  progressAdaptive: !!args.progressAdaptive
    };
  }
  const debugAdaptive = !!process.env.MCP_DEBUG_ADAPTIVE || !!args.progressAdaptive;
  if(debugAdaptive){
    process.stderr.write(`[ADAPTIVE DEBUG] runPowerShellTool requestedSeconds=${timeoutSeconds} baseConfiguredMs=${timeout} progressAdaptive=${!!args.progressAdaptive} maxTotalMs=${adaptiveConfig?.maxTotalMs} extendWindowMs=${adaptiveConfig?.extendWindowMs} extendStepMs=${adaptiveConfig?.extendStepMs}\n`);
  }
  let result = await executePowerShell(command, timeout, args.workingDirectory, adaptiveConfig ? { adaptive: adaptiveConfig } : undefined);
<<<<<<< HEAD
=======
  if(process.env.MCP_CAPTURE_PS_METRICS==='1' && (result as any).psCpuSec !== undefined){
    (result as any).psProcessMetrics = { CpuSec: (result as any).psCpuSec, WS: (result as any).psWSMB };
  }
  // Output overflow protection
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
  const maxKB = ENTERPRISE_CONFIG.limits.maxOutputKB || 512;
  const maxLines = ENTERPRISE_CONFIG.limits.maxLines || 4000;
  let truncated = false;
  const truncateIndicator = ENTERPRISE_CONFIG.logging.truncateIndicator || '...TRUNCATED...';
  const processField = (text:string)=>{
    if(!text) return text;
    let lines = text.split(/\r?\n/);
    if(lines.length> maxLines){ lines = lines.slice(0, maxLines); truncated = true; }
    let joined = lines.join('\n');
    const bytes = Buffer.byteLength(joined,'utf8');
    if(bytes > maxKB*1024){
      const buf = Buffer.from(joined,'utf8');
      const slice = buf.slice(0, maxKB*1024);
      joined = slice.toString('utf8') + truncateIndicator;
      truncated = true;
    }
    return joined;
  };
  const rebuild = (chunksArr:any[])=> chunksArr.map(c=>c.text).join('');
  result.stdout = processField(rebuild(result.chunks?.stdout||[]));
  result.stderr = processField(rebuild(result.chunks?.stderr||[]));
  if(truncated) result.truncated = true;
  if(result.overflow){ result.truncated = true; }
<<<<<<< HEAD
  if(result.overflow){
    result.overflowStrategy = 'terminate';
    if(!result.terminationReason) result.terminationReason = 'overflow';
=======
  // Determine overflow strategy considering environment override
  const envStrategy = (process.env.MCP_OVERFLOW_STRATEGY||'').toLowerCase();
  if(result.overflow){
    // Strategies:
    //  return (default): respond early with synthetic exitCode 137
    //  truncate: allow completion but truncate data
    //  terminate: force kill (explicit env setting)
    if(envStrategy === 'terminate'){
      result.overflowStrategy = 'terminate';
    } else if(envStrategy === 'truncate'){
      result.overflowStrategy = 'truncate';
    } else {
      result.overflowStrategy = 'return';
    }
    result.reason = 'output_overflow';
    if(result.overflowStrategy === 'return'){ result.exitCode = 137; }
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
  } else if(result.truncated){
    result.overflowStrategy = 'truncate';
  } else {
    result.overflowStrategy = 'return';
  }
<<<<<<< HEAD
  if(result.timedOut && !result.terminationReason) result.terminationReason = 'timeout';
  if(!result.timedOut && !result.overflow && result.exitCode!==0 && !result.terminationReason){ result.terminationReason='killed'; }
  if(result.exitCode===0 && !result.timedOut && !result.overflow) result.terminationReason = 'completed';
=======
  if(result.overflowStrategy === 'truncate' && (result.exitCode === null || typeof result.exitCode === 'undefined')){
    // If PowerShell still running when we decide to truncate, treat as successful continuation (exitCode 0)
    result.exitCode = 0;
  }
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
  if(result.timedOut){ try{ metricsRegistry.incrementTimeout(); }catch{} }
  const hadSentinel = (result as any).psCpuSec !== undefined && (result as any).psWSMB !== undefined;
  metricsRegistry.record({ level: assessment.level as any, blocked: assessment.blocked, durationMs: result.duration_ms || 0, truncated: !!result.truncated, psCpuSec: (result as any).psCpuSec, psWSMB: (result as any).psWSMB });
  try { metricsHttpServer.publishExecution({ id:`exec-${Date.now()}`, level: assessment.level, durationMs: result.duration_ms||0, blocked: assessment.blocked, truncated: !!result.truncated, timestamp:new Date().toISOString(), preview: command.substring(0,120), success: result.success, exitCode: result.exitCode, confirmed: args.confirmed||false, timedOut: result.timedOut, toolName: 'run-powershell' }); } catch {}
<<<<<<< HEAD
  auditLog('INFO','POWERSHELL_EXEC','Command executed', { level: assessment.level, reason: assessment.reason, durationMs: result.duration_ms, success: result.success, terminationReason: result.terminationReason, shellExe: result.shellExe, shellSource: result.shellSource });
  const responseObject = { ...result, securityAssessment: assessment, originalTimeoutSeconds: timeoutSeconds, warnings };
=======
  auditLog('INFO','POWERSHELL_EXEC','Command executed', { level: assessment.level, reason: assessment.reason, durationMs: result.duration_ms, success: result.success });
  const responseObject = { ...result, securityAssessment: assessment, originalTimeoutSeconds: timeoutSeconds, warnings, shellExe: result.shellExe };
  // To reduce duplicate rendering in clients that show both `content` and `structuredContent`,
  // only place human-readable stream data in `content` (stdout/stderr) while full metadata lives in structuredContent.
>>>>>>> ade15a4 (chore: cleanup instrumentation, add port reclaim flag, enforce rate limiting, bump 1.2.1)
  const content:any[] = [];
  if(responseObject.stdout){ content.push({ type:'text', text: responseObject.stdout }); }
  if(responseObject.stderr){ content.push({ type:'text', text: responseObject.stderr }); }
  if(content.length===0){
    const flags: string[] = [];
    if(responseObject.timedOut) flags.push('timedOut=true');
    if(responseObject.internalSelfDestruct) flags.push('internalSelfDestruct');
    if(responseObject.truncated) flags.push('truncated');
    if(responseObject.terminationReason) flags.push('reason='+responseObject.terminationReason);
    content.push({ type:'text', text: `[exit=${responseObject.exitCode} success=${responseObject.success}${flags.length?' '+flags.join(' '):''}]` });
  }
  content.push({ type:'text', text: `[classification=${assessment.level} blocked=${assessment.blocked} requiresPrompt=${assessment.requiresPrompt}]` });
  return { content, structuredContent: responseObject };
}