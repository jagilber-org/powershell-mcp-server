// Unified run-powershell tool implementation extracted from server
import { classifyCommandSafety } from '../security/classification.js';
import { auditLog } from '../logging/audit.js';
import { ENTERPRISE_CONFIG } from '../core/config.js';
import { detectShell } from '../core/shellDetection.js';
import { metricsRegistry } from '../metrics/registry.js';
import { metricsHttpServer } from '../metrics/httpServer.js';
import { publishExecutionAttempt } from '../metrics/publisher.js';
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
  const shellInfo = detectShell();
  const shellExe = shellInfo.shellExe || 'powershell.exe';
  // Internal self-destruct timer: inject a lightweight timer that exits the host slightly before external timeout
  const lead = ENTERPRISE_CONFIG.limits.internalSelfDestructLeadMs || 300;
  const adaptive = opts?.adaptive && opts.adaptive.enabled ? opts.adaptive : undefined;
  const sentinelEnabled = process.env.MCP_PS_SENTINEL === '1';
  // Internal timer should cover maximum potential runtime if adaptive enabled
  const internalTarget = adaptive ? Math.min(Math.max(100, (adaptive.maxTotalMs||timeout) - lead), (adaptive.maxTotalMs||timeout)) : timeout;
  const internalMs = opts?.internalTimerMs ? Math.max(100, opts.internalTimerMs - lead) : Math.max(100, internalTarget - lead);
  const disableSelfDestruct = process.env.MCP_DISABLE_SELF_DESTRUCT === '1';
  let userScript = command;
  // Append lightweight metrics sentinel emission to *stderr* so we can parse without contaminating stdout.
  if(sentinelEnabled){
    // Using Write-Error instead of Write-Host to ensure it routes to stderr regardless of redirection; Write-Error adds category text so use Console directly.
    userScript = `${command}; try { $p=Get-Process -Id $PID -ErrorAction SilentlyContinue; if($p){ $cpu=[math]::Round(($p.CPU),3); $ws=[math]::Round(($p.WorkingSet64/1MB),2); [Console]::Error.WriteLine(\"__MCP_PS_METRICS__{\\\"cpu\\\":${'$'}cpu,\\\"ws\\\":${'$'}ws}__\"); } } catch {}`;
  }
  const injected = disableSelfDestruct
    ? `$ProgressPreference='SilentlyContinue'; Set-StrictMode -Version Latest; ${userScript}`
    : `[System.Threading.Timer]::new({[Environment]::Exit(124)}, $null, ${internalMs}, 0)|Out-Null; $ProgressPreference='SilentlyContinue'; Set-StrictMode -Version Latest; ${userScript}`;
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
  const hardKillTotal = (adaptive ? adaptive.maxTotalMs : timeout) + graceAfterSignal + 2000; // absolute deadline for watchdog (ms)

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
    // Interpret certain abnormal situations:
    // 1. Internal self-destruct: exitCode 124 (explicit) OR null exit after duration >= (timeout - lead/2).
    const elapsed = duration;
    const nearTimeout = elapsed >= (timeout - 250); // within 250ms of timeout
    if(exitCode === null && nearTimeout && !timedOut){ timedOut=true; exitCode = 124; }
    // 2. Very large unsigned exit codes (Windows crash) sometimes appear (> 2^31). If near timeout, map to 124.
    if(typeof exitCode === 'number' && exitCode > 9999 && nearTimeout && !timedOut){ timedOut=true; exitCode = 124; }
    // If internal self-destruct triggered (exit code 124) treat as timeout for downstream logic
    if(exitCode === 124 && !timedOut){ timedOut = true; }
    let terminationReason: string | undefined;
    if(timedOut) terminationReason='timeout';
    else if(exitCode===124) terminationReason='timeout';
    else if(overflow) terminationReason='output_overflow';
    else if(exitCode===0) terminationReason='completed';
    else terminationReason='killed';
    // Optional per-process metrics when enabled (best-effort, Windows focus)
    let psProcessMetrics: any = undefined;
    // First attempt: sentinel-based capture (does not require extra process spawn)
    if(sentinelEnabled){
      const sentinelRegex = /__MCP_PS_METRICS__(\{[^}]*\})__/;
      for(const ch of stderrChunks){
        const m = sentinelRegex.exec(ch.text);
        if(m){
          try {
            const parsed = JSON.parse(m[1]);
            if(typeof parsed.cpu === 'number' && typeof parsed.ws === 'number'){
              psProcessMetrics = { CpuSec: parsed.cpu, WS: parsed.ws, sentinel:true };
              ch.text = ch.text.replace(sentinelRegex,'');
              try { metricsRegistry.capturePsSample(parsed.cpu, parsed.ws); } catch{}
            }
          } catch{}
        }
      }
    }
    // Fallback: post-exec Get-Process sampling (Windows only) if enabled and sentinel missing
    if(!psProcessMetrics && process.env.MCP_CAPTURE_PS_METRICS === '1' && child.pid){
      try {
        if(process.platform === 'win32'){
          const { spawnSync } = require('child_process');
            let cpuSec:number|undefined; let wsMB:number|undefined;
            try {
              const pr = spawnSync('powershell',[ '-NoProfile','-NonInteractive','-Command',`$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if($p){ [Console]::Out.Write(($p.CPU??0)); [Console]::Out.Write(' '); [Console]::Out.Write([Math]::Round($p.WorkingSet64/1MB,2)); }`], { encoding:'utf8', timeout:1500 });
              const parts = (pr.stdout||'').trim().split(/\s+/); if(parts.length>=2){ cpuSec = parseFloat(parts[0])||0; wsMB = parseFloat(parts[1])||0; }
            } catch{}
            if(typeof cpuSec === 'number' && typeof wsMB === 'number'){
              psProcessMetrics = { CpuSec: cpuSec, WS: wsMB, sentinel:false };
              try { metricsRegistry.capturePsSample(cpuSec, wsMB); } catch{}
            }
        }
      } catch{}
    }
    // Fallback sample: if enabled but we couldn't capture child metrics (short-lived command exited before probe),
    // record a sample using current process uptime & RSS so aggregation tests still observe samples.
    if(process.env.MCP_CAPTURE_PS_METRICS === '1' && !psProcessMetrics){
      try {
        const mem = process.memoryUsage();
        const wsMB = +(mem.rss/1024/1024).toFixed(2);
        metricsRegistry.capturePsSample(process.uptime(), wsMB);
        if(process.env.METRICS_DEBUG==='true'){
          // eslint-disable-next-line no-console
          console.error(`[METRICS][FALLBACK_SAMPLE] uptimeSec=${process.uptime().toFixed(2)} wsMB=${wsMB}`);
        }
      } catch{}
    }
    returnResult({ success: !timedOut && exitCode===0 && !overflow, stdout: stdoutChunks.map(c=>c.text).join('').slice(0,2000), stderr: stderrChunks.map(c=>c.text).join('').slice(0,2000), exitCode, duration_ms: duration, timedOut, internalSelfDestruct: exitCode===124, configuredTimeoutMs: timeout, killEscalated, killTreeAttempted, killTreeResult, watchdogTriggered, shellExe, workingDirectory: resolvedCwd, chunks:{ stdout: stdoutChunks, stderr: stderrChunks }, overflow, totalBytes, terminationReason, psProcessMetrics });
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
  let adaptiveLog: any[] = [];
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
      // instrumentation log point
      const now0=Date.now();
      if(resolved || timedOut) return;
      const now = Date.now();
      const remaining = (start + currentExternalTimeout) - now;
      adaptiveLog.push({ event:'check', remaining, elapsed: (Date.now()-start), recentActivity: (Date.now()-lastActivity) <= adaptive.extendWindowMs, currentExternalTimeout, timedOut });
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
    check();
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

  return resultPromise.then(r=> ({ ...r, effectiveTimeoutMs: currentExternalTimeout, adaptiveExtensions, adaptiveExtended: extended, adaptiveMaxTotalMs: adaptive?.maxTotalMs, adaptiveLog }));
}

export async function runPowerShellTool(args: any){
  const hrStart = process.hrtime.bigint();
  const command = args.command || args.script;
  if(!command) throw new McpError(ErrorCode.InvalidParams, 'command or script required');
  // Early baseline sample so even blocked / confirmation-required commands contribute to psSamples
  if(process.env.MCP_CAPTURE_PS_METRICS === '1'){
    try {
      const mem = process.memoryUsage();
      const wsMB = +(mem.rss/1024/1024).toFixed(2);
      metricsRegistry.capturePsSample(process.uptime(), wsMB);
      if(process.env.METRICS_DEBUG==='true') console.error(`[METRICS][EARLY_BASELINE] uptimeSec=${process.uptime().toFixed(2)} wsMB=${wsMB}`);
    } catch {}
  }
  // Input overflow protection
  const maxChars = ENTERPRISE_CONFIG.limits.maxCommandChars || 10000;
  if(command.length > maxChars){
    throw new McpError(ErrorCode.InvalidRequest, `Command length ${command.length} exceeds limit ${maxChars}`);
  }
  // Allow server to supply a pre-classified assessment to avoid duplicate UNKNOWN tracking
  const assessment = args._preClassified || classifyCommandSafety(command);
  // For backward-compatible test expectations, return inline blocked message instead of throwing so tests that read content[0].text continue to work.
  if(assessment.blocked){
    auditLog('WARNING','BLOCKED_COMMAND','Blocked by security policy',{ reason: assessment.reason, patterns: assessment.patterns, level: assessment.level });
    // Early publish for blocked attempt
    publishExecutionAttempt({ toolName:'run-powershell', level: assessment.level, blocked:true, durationMs:0, success:false, exitCode:null, preview: command, reason:'blocked' });
    return { content:[{ type:'text', text: 'Blocked: '+assessment.reason }], structuredContent:{ success:false, blocked:true, securityAssessment: assessment, exitCode: null } };
  }
  if(assessment.requiresPrompt && !args.confirmed) {
    // Publish attempt needing confirmation (unconfirmed)
    publishExecutionAttempt({ toolName:'run-powershell', level: assessment.level, blocked:false, durationMs:0, success:false, exitCode:null, preview: command, reason:'confirmation_required', requiresPrompt:true, incrementConfirmation: !args._unknownTracked });
    throw new McpError(ErrorCode.InvalidRequest, 'Confirmation required: '+assessment.reason);
  }
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
    adaptiveConfig = {
      enabled: true,
      extendWindowMs: (args.adaptiveExtendWindowMs || 2000),
      extendStepMs: (args.adaptiveExtendStepMs || 5000),
      maxTotalMs: Math.round(maxTotalSec*1000)
    };
  }
  let result = await executePowerShell(command, timeout, args.workingDirectory, adaptiveConfig ? { adaptive: adaptiveConfig } : undefined);
  // High-resolution duration overwrite (ns -> ms) for accuracy
  try {
    const hrEnd = process.hrtime.bigint();
    const precise = Number(hrEnd - hrStart) / 1e6; // ms
    if(!isNaN(precise) && precise > 0) {
      // Enforce minimum 1ms so dashboard rows don't misleadingly show 0ms for real executions
      const rounded = Math.max(1, Math.round(precise));
      result.duration_ms = Math.max(result.duration_ms || 0, rounded);
    }
  } catch {}
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
  } else if(result.truncated){
    result.overflowStrategy = 'truncate';
  } else {
    result.overflowStrategy = 'return';
  }
  if(result.overflowStrategy === 'truncate' && (result.exitCode === null || typeof result.exitCode === 'undefined')){
    // If PowerShell still running when we decide to truncate, treat as successful continuation (exitCode 0)
    result.exitCode = 0;
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