// Unified run-powershell tool implementation extracted from server
import { classifyCommandSafety } from '../security/classification.js';
import { auditLog } from '../logging/audit.js';
import { ENTERPRISE_CONFIG } from '../core/config.js';
import { metricsRegistry } from '../metrics/registry.js';
import { metricsHttpServer } from '../metrics/httpServer.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function killProcessTreeWindows(pid: number): Promise<{ ok: boolean; stdout: string; stderr: string }>{
  return new Promise(resolve=>{
    // Use taskkill to terminate entire process tree (/T) forcefully (/F)
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F']);
    let kStdout=''; let kStderr='';
    killer.stdout.on('data', d=> kStdout += d.toString());
    killer.stderr.on('data', d=> kStderr += d.toString());
    killer.on('close', code=> resolve({ ok: code===0, stdout: kStdout.trim(), stderr: kStderr.trim() }));
  });
}

interface AdaptiveConfig {
  enabled: boolean;              // whether adaptive extension is enabled
  extendWindowMs: number;        // if remaining time <= this AND recent activity, extend
  extendStepMs: number;          // amount to extend per step
  maxTotalMs: number;            // hard cap on external timeout
}

export async function executePowerShell(command: string, timeout: number, workingDirectory?: string, opts?: { internalTimerMs?: number; adaptive?: AdaptiveConfig }){
  const start = Date.now();
  let resolvedCwd: string | undefined = undefined;
  if(workingDirectory){
    // Resolve symlinks / relative segments for consistent policy evaluation
    try { resolvedCwd = fs.realpathSync(workingDirectory); } catch { throw new McpError(ErrorCode.InvalidRequest, 'Working directory not found'); }
    if(ENTERPRISE_CONFIG.security.enforceWorkingDirectory){
      const allowed = ENTERPRISE_CONFIG.security.allowedWriteRoots.some((root:string)=> {
        const resolvedRoot = path.resolve(root.replace('${TEMP}', os.tmpdir()));
        return resolvedCwd!.startsWith(resolvedRoot);
      });
      if(!allowed){
        throw new McpError(ErrorCode.InvalidRequest,'Working directory outside allowed roots');
      }
    }
  }

  // Choose shell (prefer pwsh if available & configured) - simple heuristic
  // Prefer pwsh.exe (PowerShell Core) when available; fallback to Windows PowerShell.
  let shellExe = ENTERPRISE_CONFIG?.powershell?.executable;
  if(!shellExe){
    // Lazy one-time detection cached on ENTERPRISE_CONFIG
    if(typeof ENTERPRISE_CONFIG._detectedPwsh === 'undefined'){
      try {
        const test = spawn('pwsh.exe',['-NoLogo','-NoProfile','-Command','"$PSVersionTable.PSEdition"'], { windowsHide:true });
        let out='';
        test.stdout.on('data',d=> out+=d.toString());
        test.on('close',code=>{ ENTERPRISE_CONFIG._detectedPwsh = (code===0 && /core/i.test(out)); });
      } catch { ENTERPRISE_CONFIG._detectedPwsh = false; }
      // Default assumption until async close sets flag
      ENTERPRISE_CONFIG._detectedPwsh = ENTERPRISE_CONFIG._detectedPwsh ?? false;
    }
    shellExe = ENTERPRISE_CONFIG._detectedPwsh ? 'pwsh.exe' : 'powershell.exe';
  }
  // Internal self-destruct timer: inject a lightweight timer that exits the host slightly before external timeout
  const lead = ENTERPRISE_CONFIG.limits.internalSelfDestructLeadMs || 300;
  const adaptive = opts?.adaptive && opts.adaptive.enabled ? opts.adaptive : undefined;
  // Internal timer should cover maximum potential runtime if adaptive enabled
  const internalTarget = adaptive ? Math.min(Math.max(100, (adaptive.maxTotalMs||timeout) - lead), (adaptive.maxTotalMs||timeout)) : timeout;
  const internalMs = opts?.internalTimerMs ? Math.max(100, opts.internalTimerMs - lead) : Math.max(100, internalTarget - lead);
  const injected = `[System.Threading.Timer]::new({[Environment]::Exit(124)}, $null, ${internalMs}, 0)|Out-Null; $ProgressPreference='SilentlyContinue'; Set-StrictMode -Version Latest; ${command}`;
  // Pass cwd only if provided (avoids unexpected directory requirement). If not supplied, node inherits server cwd.
  const child = spawn(shellExe, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', injected], { windowsHide:true, cwd: resolvedCwd });
  let stdout=''; let stderr='';
  const stdoutChunks: { seq:number; text:string; bytes:number }[] = [];
  const stderrChunks: { seq:number; text:string; bytes:number }[] = [];
  const chunkBytes = (ENTERPRISE_CONFIG.limits.chunkKB || 64)*1024;
  const maxTotalBytes = (ENTERPRISE_CONFIG.limits.maxOutputKB || 512)*1024;
  let totalBytes=0; let overflow=false;
  let timedOut=false; let killEscalated=false; let killTreeAttempted=false; let killTreeResult: any = null; let watchdogTriggered=false; let resolved=false;
  const graceAfterSignal = 1500; // ms to wait after first TERM
  const hardKillTotal = timeout + graceAfterSignal + 2000; // absolute deadline for watchdog (ms)

  let lastActivity = Date.now();
  const handleData = (buf:Buffer, isErr:boolean)=>{
    if(overflow) return; // ignore after overflow triggered
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

  const finish = (exitCode: number|null)=>{
    if(resolved) return; resolved=true; clearTimeout(timeoutHandle); clearTimeout(watchdogHandle);
    const duration = Date.now()-start;
    // flush remaining buffers as final chunks
    const flushBuf = (text:string, isErr:boolean)=>{
      if(!text) return; const bytes = Buffer.byteLength(text,'utf8');
      const arr = isErr? stderrChunks: stdoutChunks;
      arr.push({ seq: arr.length, text, bytes }); totalBytes += bytes;
    };
    flushBuf(stdout,false); flushBuf(stderr,true);
    // If internal self-destruct triggered (exit code 124) treat as timeout for downstream logic
    if(exitCode === 124 && !timedOut){ timedOut = true; }
  returnResult({ success: !timedOut && exitCode===0 && !overflow, stdout: stdoutChunks.map(c=>c.text).join('').slice(0,2000), stderr: stderrChunks.map(c=>c.text).join('').slice(0,2000), exitCode, duration_ms: duration, timedOut, internalSelfDestruct: exitCode===124, configuredTimeoutMs: timeout, killEscalated, killTreeAttempted, killTreeResult, watchdogTriggered, shellExe, workingDirectory: resolvedCwd, chunks:{ stdout: stdoutChunks, stderr: stderrChunks }, overflow, totalBytes });
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
  const scheduleExternalTimeout = (ms:number)=> setTimeout(()=>{
    timedOut=true;
    try{ child.kill('SIGTERM'); }catch{}
    // escalate after grace
    setTimeout(async ()=>{
      if(!child.killed){
        killEscalated=true; try{ child.kill('SIGKILL'); }catch{}
        const verifyUntil = Date.now() + (ENTERPRISE_CONFIG.limits.killVerifyWindowMs||1500);
        const verify = async ()=>{
          if(child.killed) return; // already flagged
          if(Date.now()>verifyUntil){ if(!child.killed) await attemptProcessTreeKill(); return; }
          // Probe process existence on Windows via tasklist (lightweight) only if still not closed
          if(process.platform==='win32' && child.pid){
            const tl = spawn('tasklist',['/FI',`PID eq ${child.pid}`]);
            let out=''; tl.stdout.on('data',d=> out+=d.toString());
            tl.on('close', async ()=>{ if(/${child.pid}/.test(out)) setTimeout(verify,200); });
          } else {
            setTimeout(verify,200);
          }
        };
        setTimeout(async ()=>{ if(!child.killed) verify(); }, 200);
      }
    }, graceAfterSignal);
  }, ms);
  let timeoutHandle = scheduleExternalTimeout(timeout);

  // Adaptive extension loop
  let adaptiveCheckTimer: NodeJS.Timeout | null = null;
  if(adaptive){
    const check = ()=>{
      if(resolved || timedOut) return;
      const now = Date.now();
      const remaining = (start + currentExternalTimeout) - now;
      if(remaining <= adaptive.extendWindowMs){
        const recentActivity = (now - lastActivity) <= adaptive.extendWindowMs;
        const elapsed = now - start;
        const canExtend = recentActivity && (elapsed + adaptive.extendStepMs) <= adaptive.maxTotalMs;
        if(canExtend){
          clearTimeout(timeoutHandle);
          currentExternalTimeout += adaptive.extendStepMs;
            timeoutHandle = scheduleExternalTimeout(currentExternalTimeout - elapsed);
          adaptiveExtensions += 1; extended = true;
        }
      }
      if(!resolved && !timedOut && (Date.now()-start) < adaptive.maxTotalMs){
        adaptiveCheckTimer = setTimeout(check, Math.min( adaptive.extendWindowMs/2, 1000));
      }
    };
    adaptiveCheckTimer = setTimeout(check, Math.min(adaptive.extendWindowMs/2, 1000));
  }

  // Watchdog: force resolve even if we never get 'close' (rare but can happen with stuck handles)
  const watchdogHandle = setTimeout(async ()=>{
  if(resolved) return; watchdogTriggered=true;
    // final brutal attempt before giving up
    try{ if(child.pid) await attemptProcessTreeKill(); }catch{}
    finish(null);
  }, hardKillTotal);

  child.on('error', _e=>{ /* capture in stderr already */ });
  child.on('close', code=> finish(code));

  return resultPromise.then(r=> ({ ...r, effectiveTimeoutMs: currentExternalTimeout, adaptiveExtensions, adaptiveExtended: extended, adaptiveMaxTotalMs: adaptive?.maxTotalMs }));
}

export async function runPowerShellTool(args: any){
  const command = args.command || args.script;
  if(!command) throw new McpError(ErrorCode.InvalidParams, 'command or script required');
  // Input overflow protection
  const maxChars = ENTERPRISE_CONFIG.limits.maxCommandChars || 10000;
  if(command.length > maxChars){
    throw new McpError(ErrorCode.InvalidRequest, `Command length ${command.length} exceeds limit ${maxChars}`);
  }
  const assessment = classifyCommandSafety(command);
  // For backward-compatible test expectations, return inline blocked message instead of throwing so tests that read content[0].text continue to work.
  if(assessment.blocked){
    auditLog('WARNING','BLOCKED_COMMAND','Blocked by security policy',{ reason: assessment.reason, patterns: assessment.patterns, level: assessment.level });
    return { content:[{ type:'text', text: 'Blocked: '+assessment.reason }], structuredContent:{ success:false, blocked:true, securityAssessment: assessment, exitCode: null } };
  }
  if(assessment.requiresPrompt && !args.confirmed) {
    // Maintain error path here so caller learns confirmation needed
    throw new McpError(ErrorCode.InvalidRequest, 'Confirmation required: '+assessment.reason);
  }
  // Timeout is always interpreted as seconds (agent contract) then converted to ms; default config already in ms
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
  // Adaptive timeout configuration
  const adaptiveEnabled = !!args.adaptiveTimeout || !!args.progressAdaptive;
  let adaptiveConfig: AdaptiveConfig | undefined = undefined;
  if(adaptiveEnabled){
    const maxTotalSec = args.adaptiveMaxTotalSec || args.adaptiveMaxSec || Math.min(timeoutSeconds*3, 180); // cap 3x or 180s
    adaptiveConfig = {
      enabled: true,
      extendWindowMs: (args.adaptiveExtendWindowMs || 2000),
      extendStepMs: (args.adaptiveExtendStepMs || 5000),
      maxTotalMs: Math.round(maxTotalSec*1000)
    };
  }
  let result = await executePowerShell(command, timeout, args.workingDirectory, adaptiveConfig ? { adaptive: adaptiveConfig } : undefined);
  // Output overflow protection
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
      // binary-safe cut
      const buf = Buffer.from(joined,'utf8');
      const slice = buf.slice(0, maxKB*1024);
      joined = slice.toString('utf8') + truncateIndicator;
      truncated = true;
    }
    return joined;
  };
  // Reconstruct bounded stdout/stderr preview from chunks then apply line/size truncation
  const rebuild = (chunksArr:any[])=> chunksArr.map(c=>c.text).join('');
  result.stdout = processField(rebuild(result.chunks?.stdout||[]));
  result.stderr = processField(rebuild(result.chunks?.stderr||[]));
  if(truncated) result.truncated = true;
  if(result.overflow){ result.truncated = true; }
  // Provide backward-compatible overflow strategy field
  if(result.overflow){
    result.overflowStrategy = 'terminate';
  } else if(result.truncated){
    result.overflowStrategy = 'truncate';
  } else {
    result.overflowStrategy = 'return';
  }
  if(result.timedOut){ try{ metricsRegistry.incrementTimeout(); }catch{} }
  metricsRegistry.record({ level: assessment.level as any, blocked: assessment.blocked, durationMs: result.duration_ms || 0, truncated: !!result.truncated });
  try { metricsHttpServer.publishExecution({ id:`exec-${Date.now()}`, level: assessment.level, durationMs: result.duration_ms||0, blocked: assessment.blocked, truncated: !!result.truncated, timestamp:new Date().toISOString(), preview: command.substring(0,120), success: result.success, exitCode: result.exitCode, confirmed: args.confirmed||false, timedOut: result.timedOut, toolName: 'run-powershell' }); } catch {}
  auditLog('INFO','POWERSHELL_EXEC','Command executed', { level: assessment.level, reason: assessment.reason, durationMs: result.duration_ms, success: result.success });
  const responseObject = { ...result, securityAssessment: assessment, originalTimeoutSeconds: timeoutSeconds, warnings };
  // To reduce duplicate rendering in clients that show both `content` and `structuredContent`,
  // only place human-readable stream data in `content` (stdout/stderr) while full metadata lives in structuredContent.
  const content:any[] = [];
  if(responseObject.stdout){ content.push({ type:'text', text: responseObject.stdout }); }
  if(responseObject.stderr){ content.push({ type:'text', text: responseObject.stderr }); }
  if(content.length===0){
    const flags: string[] = [];
    if(responseObject.timedOut) flags.push('timedOut=true');
    if(responseObject.internalSelfDestruct) flags.push('internalSelfDestruct');
    if(responseObject.truncated) flags.push('truncated');
    content.push({ type:'text', text: `[exit=${responseObject.exitCode} success=${responseObject.success}${flags.length?' '+flags.join(' '):''}]` });
  }
  // Optional appended classification summary so tests (or humans) can regex it if needed
  content.push({ type:'text', text: `[classification=${assessment.level} blocked=${assessment.blocked} requiresPrompt=${assessment.requiresPrompt}]` });
  return { content, structuredContent: responseObject };
}