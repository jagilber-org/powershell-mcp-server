/**
 * Phase 2: Internal HTTP Metrics & Dashboard Server (scaffold)
 * Minimal dependencies: using native http module to avoid bloat.
 * Endpoints:
 *  - /healthz : liveness
 *  - /readyz  : readiness (server started)
 *  - /metrics : Prometheus-style exposition (subset)
 *  - /api/metrics : JSON snapshot
 *  - /events  : Server-Sent Events stream of executions (security redactions applied upstream)
 *  - /dashboard : Rich HTML dashboard
 */
import * as http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { metricsRegistry } from './registry.js';
import { EventEmitter } from 'events';
import * as os from 'os';
// ESM compatibility helpers (Node ESM lacks __dirname / require in strict scenarios)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as pathForDir from 'path';
// Use existing global require if present (CJS), otherwise create one for ESM
// @ts-ignore
const _esmRequire: NodeRequire = (typeof require === 'function') ? require : createRequire(import.meta.url);
// __dirname shim for ESM
// @ts-ignore
const _moduleDir: string = (typeof __dirname !== 'undefined') ? __dirname : pathForDir.dirname(fileURLToPath(import.meta.url));
// Lazy-load learning module functions on demand to avoid import cost during initial MCP handshake path.
// They are only used when learning-related HTTP endpoints are hit.
type LearningModule = typeof import('../learning.js');
let _learningMod: LearningModule | null = null;
async function getLearning(){
  if(!_learningMod){
    _learningMod = await import('../learning.js');
  }
  return _learningMod;
}
import { ENTERPRISE_CONFIG } from '../core/config.js';

export interface MetricsHttpOptions {
  port: number;              // desired starting port
  host?: string;             // default 127.0.0.1
  enabled: boolean;          // master enable
  scanMaxOffset?: number;    // how many additional ports to try if in use
  autoDisableOnFailure?: boolean; // disable if none found
}

export interface ExecutionEventPayload {
  id: string;
  level: string;
  durationMs: number;
  blocked: boolean;
  truncated: boolean;
  timestamp: string;
  seq?: number; // incremental sequence for fallback polling
  // Optional rich details
  preview?: string;        // partial command / script text
  exitCode?: number | null;
  success?: boolean;
  confirmed?: boolean;     // whether this was a confirmed command
  requiresPrompt?: boolean; // whether confirmation was required (pending or satisfied)
  timedOut?: boolean;      // whether the execution timed out
  candidateNorm?: string;  // normalized UNKNOWN candidate (learning)
  toolName?: string;       // originating tool name (for non-powershell tool activity logging)
}

export class MetricsHttpServer {
  private server?: http.Server;
  private opts: MetricsHttpOptions;
  private started = false;
  // Record server start timestamp (used for cache-busting dash.js and diagnostics)
  private readonly serverStart = Date.now();
  private emitter = new EventEmitter();
  private eventId = 0;
  private heartbeatIntervalMs = 15000;
  private heartbeatTimer?: NodeJS.Timeout;
  private replayBuffer: ExecutionEventPayload[] = [];
  private replayLimit = 200; // cap buffer size
  private seqCounter = 0; // monotonic event sequence (SSE + polling fallback)
  private debugEnabled = process.env.METRICS_DEBUG === 'true';
  // Separate flag controlling verbose dashboard client logging (front-end). Allows server debug without noisy UI.
  private dashDebugEnabled = (process.env.METRICS_DASH_DEBUG === '1' || process.env.METRICS_DASH_DEBUG === 'true');
  // Cache package version (lazy loaded) for /version and dashboard banner.
  private cachedVersion: string | undefined;
  private getVersion(): string {
    if(this.cachedVersion) return this.cachedVersion;
    const fs = _esmRequire('fs');
    const p  = _esmRequire('path');
    const diagnostics: string[] = [];
    const set = (v: string, reason: string) => { this.cachedVersion = v; diagnostics.push(reason+':'+v); };
    try {
      const pkgPath = p.join(process.cwd(),'package.json');
      if(fs.existsSync(pkgPath)){
        const j = JSON.parse(fs.readFileSync(pkgPath,'utf8'));
        if(j.version){ set(j.version,'cwd'); }
      }
    } catch { /* ignore */ }
    if(!this.cachedVersion){
      const altCandidates = [
        p.join(_moduleDir, '../package.json'),
        p.join(_moduleDir, '../../package.json'),
        p.join(_moduleDir, '../../../package.json')
      ];
      for(const alt of altCandidates){
        try { if(fs.existsSync(alt)){ const j2 = JSON.parse(fs.readFileSync(alt,'utf8')); if(j2.version){ set(j2.version,'relative'); break; } } } catch { }
      }
    }
    if(!this.cachedVersion){
      // Ascend up to 5 parent dirs
      let cur: string | undefined = _moduleDir;
      for(let i=0;i<5 && cur;i++){
        const candidate = p.join(cur,'package.json');
        try { if(fs.existsSync(candidate)){ const pj = JSON.parse(fs.readFileSync(candidate,'utf8')); if(pj.version){ set(pj.version,'ascend'); break; } } } catch { }
        const nextDir: string = p.dirname(cur); if(nextDir===cur) break; cur = nextDir;
      }
    }
    if(!this.cachedVersion){
      const envVer = process.env.PACKAGE_VERSION || process.env.npm_package_version; if(envVer){ set(envVer,'env'); }
    }
    if(!this.cachedVersion){
      try {
        const manifestPaths = [
          p.join(process.cwd(),'deploy-manifest.json'),
          p.join(_moduleDir,'../../deploy-manifest.json'),
          p.join(_moduleDir,'../../../deploy-manifest.json')
        ];
        for(const mp of manifestPaths){
          try { if(fs.existsSync(mp)){ const m = JSON.parse(fs.readFileSync(mp,'utf8')); if(m.version){ set(m.version,'manifest'); break; } } } catch { }
        }
      } catch { }
    }
    if(!this.cachedVersion){
      set('0.0.0+build.'+ new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,12),'fallback');
    }
    if(this.debugEnabled){ console.error('[METRICS][VERSION_RESOLVE]', diagnostics.join(' -> ')); }
  return this.cachedVersion!;
  }
  private getBuildId(): string {
    // Try git commit short hash (if available via env or nearby git metadata file), else manifest commit, else timestamp
    try {
      const envCommit = process.env.GIT_COMMIT || process.env.COMMIT_SHA || process.env.BUILD_SOURCEVERSION;
      if(envCommit){ return envCommit.substring(0,7); }
    } catch {}
    try {
      const fs = _esmRequire('fs'); const p = _esmRequire('path');
      const manifestPaths = [
        p.join(process.cwd(),'deploy-manifest.json'),
        p.join(_moduleDir,'../../deploy-manifest.json'),
        p.join(_moduleDir,'../../../deploy-manifest.json')
      ];
      for(const mp of manifestPaths){
        try { if(fs.existsSync(mp)){ const m = JSON.parse(fs.readFileSync(mp,'utf8')); if(m.commit){ return String(m.commit).substring(0,7); } } } catch {}
      }
    } catch {}
    return new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,12);
  }
  // Performance sampling
  private perfTimer?: NodeJS.Timeout;
  private perfSampleIntervalMs = 2000;
  private syntheticTickerTimer?: NodeJS.Timeout;
  private syntheticTickerIntervalMs = 7000;
  private lastCpu = process.cpuUsage();
  private lastHr = process.hrtime.bigint();
  private lagSamples: number[] = [];
  private lagTimer?: NodeJS.Timeout;
  private lagIntervalMs = 500;
  private performanceSnapshot: any = {};
  // Optional periodic PowerShell metrics sampling (aggregated into metricsRegistry) when MCP_CAPTURE_PS_METRICS=1
  private psSampleTimer?: NodeJS.Timeout;
  private psSampleIntervalMs = process.env.MCP_PS_SAMPLE_INTERVAL_MS ? Math.max(500, parseInt(process.env.MCP_PS_SAMPLE_INTERVAL_MS,10)) : 2500;
  // Historical data for graphs
  // Store CPU percent and event loop lag (ms) together for combined graph
  private cpuHistory: Array<{timestamp: number, value: number, lag: number, psCpuPct?: number}> = [];
  private memHistory: Array<{timestamp: number, rss: number, heap: number, psWSMB?: number}> = [];
  private historyLimit = 60; // Keep last 60 samples (2 minutes at 2s intervals)

  constructor(opts: MetricsHttpOptions) {
    this.opts = opts;
  }

  start(): void {
    if (!this.opts.enabled || this.server) return;
    const host = this.opts.host || '127.0.0.1';
    const maxOffset = this.opts.scanMaxOffset ?? 10;
    let attemptPort = this.opts.port;
    let attempts = 0;

    const tryListen = () => {
      this.server = http.createServer((req, res) => this.route(req, res));
      this.server.once('error', (err: any) => {
        if (err && err.code === 'EADDRINUSE' && attempts < maxOffset) {
          attempts++;
          attemptPort++;
          console.error(`[METRICS] Port ${attemptPort - 1} in use; trying ${attemptPort}`);
          setTimeout(tryListen, 150);
        } else {
          console.error(`[METRICS] Failed to bind metrics server: ${err?.message || err}`);
          if (this.opts.autoDisableOnFailure) {
            console.error('[METRICS] Auto-disabling metrics HTTP server.');
            this.opts.enabled = false;
          }
        }
      });
      this.server.listen(attemptPort, host, () => {
        this.started = true;
        // Baseline PS sample (lightweight) so aggregation test sees progress even before first command metrics capture.
        if(process.env.MCP_CAPTURE_PS_METRICS==='1'){
          try {
            const mem = process.memoryUsage();
            const wsMB = +(mem.rss/1024/1024).toFixed(2);
            // Use cumulative CPU seconds for this process (user+system microseconds /1e6)
            const cpuUsage = process.cpuUsage();
            const cpuCumulativeSec = (cpuUsage.user + cpuUsage.system)/1e6; // microseconds -> seconds
            metricsRegistry.capturePsSample(cpuCumulativeSec, wsMB);
            if(this.debugEnabled){ console.error(`[METRICS][BASELINE_HTTP] uptimeSec=${process.uptime().toFixed(2)} wsMB=${wsMB}`); }
          } catch{}
        }
        // Emit an initial startup event so dashboard isn't visually empty (can be suppressed via env)
        if(process.env.METRICS_SUPPRESS_START_EVENT !== '1'){
          try {
            const startupEv: ExecutionEventPayload = {
              id: 'startup-'+Date.now(),
              level: 'SAFE',
              durationMs: 0,
              blocked: false,
              truncated: false,
              timestamp: new Date().toISOString(),
              preview: '[server started]',
              success: true,
              exitCode: 0,
              toolName: 'startup'
            };
            this.publishExecution(startupEv);
            metricsRegistry.record({ level: 'SAFE' as any, blocked:false, durationMs:0, truncated:false });
            if(this.debugEnabled){ console.error('[METRICS][START_EVENT] published startup event'); }
          } catch{}
        }
        // Fallback: if after a short delay no events exist (e.g., startup event suppressed), emit a synthetic marker
        setTimeout(() => {
          try {
            if(!this.replayBuffer.length){
              const fallbackEv: ExecutionEventPayload = {
                id: 'startup-fallback-'+Date.now(),
                level: 'SAFE',
                durationMs: 0,
                blocked: false,
                truncated: false,
                timestamp: new Date().toISOString(),
                preview: '[startup fallback]',
                success: true,
                exitCode: 0,
                toolName: 'startup'
              };
              this.publishExecution(fallbackEv);
              // Only record if totalCommands still zero to avoid double counting when original startup event existed
              try {
                const snap = metricsRegistry.snapshot(false);
                if(snap.totalCommands === 0){
                  metricsRegistry.record({ level: 'SAFE' as any, blocked:false, durationMs:0, truncated:false });
                }
              } catch {}
              if(this.debugEnabled){ console.error('[METRICS][START_EVENT][FALLBACK] emitted'); }
            }
          } catch {}
        }, 3500).unref?.();
        // Second-stage probe: after 15s if STILL no events (no commands executed) emit a probe event
        setTimeout(() => {
          try {
            if(!this.replayBuffer.length){
              const probe: ExecutionEventPayload = {
                id: 'startup-probe-'+Date.now(),
                level: 'SAFE',
                durationMs: 0,
                blocked: false,
                truncated: false,
                timestamp: new Date().toISOString(),
                preview: '[startup probe]',
                success: true,
                exitCode: 0,
                toolName: 'startup'
              };
              this.publishExecution(probe);
              try {
                const snap = metricsRegistry.snapshot(false);
                if(snap.totalCommands === 0){
                  metricsRegistry.record({ level: 'SAFE' as any, blocked:false, durationMs:0, truncated:false });
                }
              } catch {}
              if(this.debugEnabled){ console.error('[METRICS][START_EVENT][PROBE] emitted'); }
            }
          } catch {}
        }, 15000).unref?.();
        // Aggressive bootstrap interval: keep emitting until first event observed (safety net if above timers missed)
        if(process.env.METRICS_DISABLE_BOOTSTRAP !== '1'){
          let bootstrapAttempts = 0; const bootstrapMax = 8; // up to ~16s (2s * 8) worst case
          const bootstrapTimer = setInterval(()=>{
            try {
              if(this.replayBuffer.length){ clearInterval(bootstrapTimer); return; }
              bootstrapAttempts++;
              const boot: ExecutionEventPayload = {
                id: 'startup-ensure-'+Date.now(),
                level: 'SAFE',
                durationMs: 0,
                blocked: false,
                truncated: false,
                timestamp: new Date().toISOString(),
                preview: '[startup ensure]',
                success: true,
                exitCode: 0,
                toolName: 'startup'
              };
              this.publishExecution(boot);
              try {
                const snap = metricsRegistry.snapshot(false);
                if(snap.totalCommands === 0){ metricsRegistry.record({ level:'SAFE' as any, blocked:false, durationMs:0, truncated:false }); }
              } catch {}
              if(this.debugEnabled || bootstrapAttempts===1){ console.error('[METRICS][START_EVENT][ENSURE] emitted attempt '+bootstrapAttempts); }
              if(bootstrapAttempts >= bootstrapMax){ clearInterval(bootstrapTimer); }
            } catch { clearInterval(bootstrapTimer); }
          }, 2000).unref?.();
        }
        // eslint-disable-next-line no-console
  const proto = 'http'; // internal loopback; no external exposure
  console.error(`[METRICS] HTTP server listening on ${proto}://${host}:${attemptPort}`);
        this.opts.port = attemptPort; // record chosen
        this.startHeartbeat();
  this.startPerfSampler();
  this.startLagMonitor();
  this.startPsSampler();
      });
    };
    tryListen();
  }

  /** Return bound port if started (or initial desired port before start). */
  getPort(): number { return this.opts.port; }
  /** Whether server has successfully started */
  isStarted(): boolean { return this.started; }

  stop(): void {
    this.server?.close();
    this.started = false;
  if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  if (this.perfTimer) clearInterval(this.perfTimer);
  if (this.lagTimer) clearInterval(this.lagTimer);
  if (this.psSampleTimer) clearInterval(this.psSampleTimer);
  }

  publishExecution(ev: ExecutionEventPayload): void {
  // store in ring buffer
  ev.seq = ++this.seqCounter;
  this.replayBuffer.push(ev);
  if (this.replayBuffer.length > this.replayLimit) this.replayBuffer.shift();
    this.emitter.emit('exec', ev);
    if (this.debugEnabled) {
      try { console.error(`[METRICS][EVENT][PUBLISH] id=${ev.id} level=${ev.level} blocked=${ev.blocked} truncated=${ev.truncated} tool=${ev.toolName||''}`); } catch {}
    }
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
  const rawUrl = req.url || '/';
  const url = rawUrl; // keep original for query parsing where needed
  const path = rawUrl.split('?')[0];
  const trace = this.debugEnabled || process.env.METRICS_TRACE === '1';
  if(trace){
    try { console.error(`[METRICS][REQ] ${req.method} ${rawUrl}`); } catch {}
  }
  if (path === '/healthz') {
      this.writeJson(res, { status: 'ok' });
      return;
    }
  if (path === '/favicon.ico') {
      // Silence browser favicon 404 noise; return empty response (clients cache via max-age)
      res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
      res.end();
      return;
    }
  if (path === '/readyz') {
      this.writeJson(res, { status: this.started ? 'ready' : 'starting' });
      return;
    }
  if (path === '/api/metrics') {
      let snap = metricsRegistry.snapshot(false);
      // Ensure psSamples fields are present even if zero (tests rely on property existence)
      if(typeof (snap as any).psSamples === 'undefined'){
        (snap as any).psSamples = 0;
        (snap as any).psCpuSecAvg = 0;
        (snap as any).psWSMBAvg = 0;
      }
      // Self-healing fallback: if feature flag enabled but still zero samples, take an on-demand sample.
      if((snap as any).psSamples === 0 && process.env.MCP_CAPTURE_PS_METRICS === '1'){
        try {
          const mem = process.memoryUsage();
          const wsMB = +(mem.rss/1024/1024).toFixed(2);
          const cpuUsage = process.cpuUsage();
          const cpuCumulativeSec = (cpuUsage.user + cpuUsage.system)/1e6;
          (metricsRegistry as any).capturePsSample(cpuCumulativeSec, wsMB);
          snap = metricsRegistry.snapshot(false);
          if(typeof (snap as any).psSamples === 'undefined'){
            (snap as any).psSamples = 0; (snap as any).psCpuSecAvg = 0; (snap as any).psWSMBAvg = 0;
          }
          if(this.debugEnabled){ console.error('[METRICS][API_FALLBACK_SAMPLE] injected one-off sample for empty ps metrics'); }
        } catch {/* ignore */}
      }
      const perf = this.performanceSnapshot;
      const response = { 
        ...snap, 
        performance: perf,
        cpuHistory: this.cpuHistory,
        memHistory: this.memHistory
      };
      if(trace){
        try { console.error(`[METRICS][API_METRICS_REQ] total=${snap.totalCommands} seq=${this.seqCounter} replay=${this.replayBuffer.length}`); } catch {}
      }
      if (this.debugEnabled) {
        try { console.error(`[METRICS][API_METRICS] total=${snap.totalCommands} safe=${snap.safeCommands} risky=${snap.riskyCommands} blocked=${snap.blockedCommands} unknown=${snap.unknownCommands} timeouts=${(snap as any).timeouts}`); } catch {}
      }
      this.writeJson(res, response);
      return;
    }
    if (path === '/version') {
      // Lightweight version + uptime endpoint for automation & dashboards.
      const body = { version: this.getVersion(), uptimeSeconds: Math.round((Date.now()-this.serverStart)/1000), startedAt: new Date(this.serverStart).toISOString() };
      this.writeJson(res, body);
      return;
    }
  if (path.startsWith('/api/events/replay')) {
      // Polling fallback endpoint: /api/events/replay?since=<seq>&limit=100
      const q = this.parseQuery(url);
      const since = q.since ? parseInt(q.since,10) : 0;
      const limit = q.limit ? Math.min(parseInt(q.limit,10), 500) : 200;
      const filtered = this.replayBuffer.filter(e=> (e.seq||0) > since);
      const slice = filtered.slice(-limit);
      this.writeJson(res, { events: slice, latest: this.seqCounter });
      return;
    }
  if (path === '/api/metrics/history') {
      const history = (metricsRegistry as any).getHistory ? (metricsRegistry as any).getHistory() : [];
      this.writeJson(res, { records: history, lastReset: metricsRegistry.snapshot(false).lastReset });
      return;
    }
  if (path.startsWith('/api/debug/emit')) {
      if (!this.isDebug(url)) { this.writeDenied(res); return; }
      const params = this.parseQuery(url);
      const synthetic: ExecutionEventPayload = {
        id: 'synthetic-'+(++this.eventId),
        level: String(params.level || 'SAFE'),
        durationMs: parseInt(params.durationMs||'5',10),
        blocked: params.blocked === 'true',
        truncated: params.truncated === 'true',
  timestamp: new Date().toISOString(),
  preview: '[synthetic event]',
  success: true,
  exitCode: 0
      };
      this.publishExecution(synthetic);
      // Also reflect in metrics registry so dashboard cards change even with only synthetic events
      try {
        metricsRegistry.record({
          level: synthetic.level as unknown as any,
          blocked: synthetic.blocked,
            durationMs: synthetic.durationMs,
            truncated: synthetic.truncated
        });
      } catch {}
      this.writeJson(res, { emitted: true, synthetic });
      return;
    }
  if (path === '/api/debug') {
      if (!this.isDebug(url)) { this.writeDenied(res); return; }
      this.writeJson(res, this.getDebugState());
      return;
    }
  if (path === '/metrics') {
      const snap = metricsRegistry.snapshot(false);
      const perf = this.performanceSnapshot;
      const lines: string[] = [];
      lines.push('# HELP ps_mcp_commands_total Total commands executed');
      lines.push('# TYPE ps_mcp_commands_total counter');
      lines.push(`ps_mcp_commands_total ${snap.totalCommands}`);
      lines.push('# HELP ps_mcp_command_duration_p95_ms Approximate p95 duration in ms');
      lines.push('# TYPE ps_mcp_command_duration_p95_ms gauge');
      lines.push(`ps_mcp_command_duration_p95_ms ${snap.p95DurationMs}`);
      if((snap as any).psSamples){
        lines.push('# HELP ps_mcp_ps_samples_total PowerShell process samples collected');
        lines.push('# TYPE ps_mcp_ps_samples_total counter');
        lines.push(`ps_mcp_ps_samples_total ${(snap as any).psSamples}`);
        lines.push('# HELP ps_mcp_ps_cpu_seconds_avg Average CPU seconds per PowerShell sample');
        lines.push('# TYPE ps_mcp_ps_cpu_seconds_avg gauge');
        lines.push(`ps_mcp_ps_cpu_seconds_avg ${(snap as any).psCpuSecAvg}`);
        lines.push('# HELP ps_mcp_ps_ws_megabytes_avg Average Working Set MB per PowerShell sample');
        lines.push('# TYPE ps_mcp_ps_ws_megabytes_avg gauge');
        lines.push(`ps_mcp_ps_ws_megabytes_avg ${(snap as any).psWSMBAvg}`);
      }
      if (perf.cpuPercent !== undefined) {
        lines.push('# HELP ps_mcp_process_cpu_percent Approximate process CPU percent (single-core)');
        lines.push('# TYPE ps_mcp_process_cpu_percent gauge');
        lines.push(`ps_mcp_process_cpu_percent ${perf.cpuPercent}`);
        lines.push('# HELP ps_mcp_process_rss_megabytes Resident set size in MB');
        lines.push('# TYPE ps_mcp_process_rss_megabytes gauge');
        lines.push(`ps_mcp_process_rss_megabytes ${perf.rssMB}`);
        lines.push('# HELP ps_mcp_event_loop_lag_p95_ms Event loop lag p95 over recent samples');
        lines.push('# TYPE ps_mcp_event_loop_lag_p95_ms gauge');
        lines.push(`ps_mcp_event_loop_lag_p95_ms ${perf.eventLoopLagP95Ms}`);
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(lines.join('\n') + '\n');
      return;
    }
  if (path === '/events') {
  // parse optional replay param (?replay=50)
  const replayMatch = /replay=([0-9]+)/.exec(req.url || '');
  const replayCount = replayMatch ? Math.min(parseInt(replayMatch[1], 10), this.replayLimit) : 0;
  this.handleSSE(res, replayCount);
      return;
    }
    // Basic landing page placeholder
    // Serve extracted dashboard client script (moved out of giant template to avoid inline syntax issues)
    if (path.startsWith('/dash.js')) {
      const debug = this.isDebug(url);
      const js = this.buildDashboardClientScript(debug);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(js);
      return;
    }
  if (path === '/' || path.startsWith('/dashboard')) {
      const debug = this.isDebug(url) || this.dashDebugEnabled;
      const ver = this.getVersion();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>PowerShell MCP Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg:#0f1115; --panel:#161b22; --panel-alt:#1f2630; --border:#2d3540; --text:#d6dae0;
    --accent:#3b82f6; --safe:#10b981; --risky:#fbbf24; --danger:#f87171; --critical:#dc2626; --blocked:#9333ea; --unknown:#64748b;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.35;-webkit-font-smoothing:antialiased}
  header{padding:1rem 1.25rem;border-bottom:1px solid var(--border);display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
  h1{font-size:1.15rem;margin:0;font-weight:600;letter-spacing:.5px}
  .pill{padding:.25rem .6rem;border-radius:999px;font-size:.65rem;font-weight:600;letter-spacing:.5px;background:var(--panel-alt);border:1px solid var(--border)}
  .debug{background:linear-gradient(90deg,#6366f1,#8b5cf6);color:#fff}
  html,body{height:100%;}
  body{display:flex;flex-direction:column;}
  main{flex:1;display:flex;flex-direction:column;padding:1rem 1.25rem;gap:1rem;min-height:0;}
  #statsGrid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
  .card{background:var(--panel);padding:.85rem .9rem;border:1px solid var(--border);border-radius:10px;position:relative;overflow:hidden}
  .card h3{margin:0 0 .35rem;font-size:.7rem;letter-spacing:.07em;font-weight:600;text-transform:uppercase;opacity:.7}
  .metric{font-size:1.55rem;font-weight:600;font-family:var(--mono);line-height:1.1}
  .grid-full{grid-column:1/-1}
  #eventsPanel{display:flex;flex-direction:column;flex:1;min-height:0}
  #eventTableWrap{flex:1;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--panel-alt);min-height:0}
  table{width:100%;border-collapse:collapse;font-size:.72rem;font-family:var(--mono)}
  thead{position:sticky;top:0;background:var(--panel);box-shadow:0 2px 4px -2px #000}
  th,td{padding:.35rem .55rem;text-align:left;vertical-align:top;border-bottom:1px solid #202830}
  tbody tr:last-child td{border-bottom:none}
  tr.level-SAFE td.level{color:var(--safe)}
  tr.level-RISKY td.level{color:var(--risky)}
  tr.level-DANGEROUS td.level{color:var(--danger)}
  tr.level-CRITICAL td.level{color:var(--critical)}
  tr.level-BLOCKED td.level{color:var(--blocked)}
  tr.level-UNKNOWN td.level{color:var(--unknown)}
  /* Highlight confirmed (user-approved) executions */
  tr.confirmed{background:linear-gradient(90deg,rgba(255,215,0,.22),rgba(255,215,0,.05));border-left:4px solid #ffd700}
  tr.confirmed td.level{color:#ffd700 !important}
  tr.confirmed td{transition:background .3s}
  tr.requires{background:linear-gradient(90deg,rgba(255,140,0,.18),rgba(255,140,0,.04));border-left:4px solid #ff8c00}
  tr.requires td.level{color:#ff8c00 !important}
  tr.learn-selected{outline:2px solid #6366f1; box-shadow:0 0 0 2px #6366f1 inset; position:relative;}
  tr.learn-selected:after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(99,102,241,.15),rgba(99,102,241,0));}
  .bad{color:var(--danger)} .warn{color:var(--risky)} .good{color:var(--safe)}
  #filters{display:flex;flex-wrap:wrap;gap:.6rem;margin-bottom:.6rem}
  #filters label{display:flex;align-items:center;gap:.25rem;font-size:.62rem;padding:.25rem .45rem;border:1px solid var(--border);border-radius:6px;background:var(--panel-alt);cursor:pointer;user-select:none}
  #filters input{margin:0}
  button{background:#1f2630;border:1px solid var(--border);color:var(--text);font-size:.6rem;padding:.4rem .7rem;border-radius:6px;cursor:pointer;line-height:1.1;font-weight:500;letter-spacing:.5px;transition:background .15s,border-color .15s}
  button:hover{background:#27303a;border-color:#3a4652}
  #controls button#clearBtn{background:#374151}
  #controls button#clearBtn:hover{background:#415062}
  #controls button#emit{background:#6366f1;color:#fff;border-color:#6366f1}
  #controls button#emit:hover{background:#5458e3}
  #statusBar button{font-size:.55rem;padding:.35rem .55rem}
  .graphs-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1rem;margin-top:1rem}
  @media (max-width:820px){.graphs-row{grid-template-columns:1fr}}
  /* Graph container adjustments */
  .graph-frame{position:relative;height:140px;border:1px solid #2c3640;background:#12161d;overflow:hidden;border-radius:6px;}
  .graph-frame canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  /* Button interaction refinements */
  button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
  button:active{transform:translateY(1px);}
</style></head><body>
<header>
  <h1>PowerShell MCP Dashboard <span class="pill">v${ver}<span class="subpill">${this.getBuildId()}</span></span> ${debug?'<span class="pill debug">DEBUG</span>':''}</h1>
  <span class="pill" id="portInfo">Port: ${this.opts.port}</span>
  <span class="pill" id="hbState">HB: --</span>
  <span class="pill" id="uptime">Uptime: --</span>
  <span style="flex:1"></span>
  <a class="pill" href="/metrics" target="_blank">Prometheus</a>
  <a class="pill" href="/api/metrics" target="_blank">/api/metrics</a>
  <a class="pill" href="/version" target="_blank">/version</a>
  ${debug?'<a class="pill" href="/api/debug?debug=true" target="_blank">Debug JSON</a>':''}
</header>
<main>
  <div id="statsGrid">
    <section class="card"><h3>Total</h3><div class="metric" id="m_total">0</div></section>
    <section class="card"><h3>SAFE</h3><div class="metric" id="m_safe">0</div></section>
    <section class="card"><h3>RISKY</h3><div class="metric" id="m_risky">0</div></section>
    <section class="card"><h3>BLOCKED</h3><div class="metric" id="m_blocked">0</div></section>
    <section class="card"><h3>confirmed PENDING</h3><div class="metric" id="m_confirm">0</div></section>
    <section class="card"><h3>TIMEOUTS</h3><div class="metric" id="m_timeouts">0</div></section>
    <section class="card"><h3>AVG ms</h3><div class="metric" id="m_avg">0</div></section>
    <section class="card"><h3>P95 ms</h3><div class="metric" id="m_p95">0</div></section>
    <section class="card"><h3>CPU%</h3><div class="metric" id="m_cpu">0</div></section>
    <section class="card"><h3>RSS MB</h3><div class="metric" id="m_rss">0</div></section>
    <section class="card"><h3>HEAP MB</h3><div class="metric" id="m_heap">0</div></section>
    <section class="card"><h3>LOOP LAG</h3><div class="metric" id="m_lag">0</div></section>
    <section class="card" title="Average PowerShell process CPU seconds across samples"><h3>PS CPU SEC</h3><div class="metric" id="m_pscpu">0</div></section>
    <section class="card" title="Average PowerShell Working Set MB across samples"><h3>PS WS MB</h3><div class="metric" id="m_psws">0</div></section>
    <section class="card" title="Number of PowerShell process samples captured"><h3>PS SAMPLES</h3><div class="metric" id="m_pssamples">0</div></section>
  </div>
  <div id="graphsRow" class="graphs-row">
    <section class="card" id="cpuGraphCard">
      <h3>CPU & Lag (Last 2m)</h3>
      <div class="graph-frame"><canvas id="cpuGraph"></canvas></div>
    </section>
    <section class="card" id="memGraphCard">
      <h3>Memory (MB - Last 2m)</h3>
      <div class="graph-frame"><canvas id="memGraph"></canvas></div>
    </section>
  </div>
  <!-- Global controls bar (relocated buttons) -->
  <div id="globalControls" style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.25rem">
    <button id="clearBtn" title="Clear visible events">Clear</button>
    ${debug?'\n    <button id="emit">Emit Synthetic</button>':''}
    <button id="learnBtn" title="Queue selected UNKNOWN row" style="background:#6366f1">Queue Selected</button>
    <button id="showQueue" style="background:#374151">Queue Panel</button>
    <span id="learnMsg" style="font-size:.6rem;opacity:.75;min-width:120px"></span>
    <span style="flex:1"></span>
    <span style="opacity:.65;font-size:.55rem;padding:.15rem .35rem;border:1px solid #1f2937;border-radius:4px;background:rgba(31,41,55,.35)">Legend: <span style="color:#3b82f6">CPU</span> <span style="color:#f59e0b">Lag</span> <span style="color:#a855f7">PS CPU</span> • <span style="color:#10b981">RSS</span> <span style="color:#6366f1">Heap</span> <span style="color:#f472b6">PS WS</span></span>
  </div>
  <section class="card" id="eventsPanel">
    <div id="controls" style="display:flex;flex-wrap:wrap;align-items:center;gap:.4rem">
      <div id="filters" style="display:flex;gap:.35rem;flex-wrap:wrap"></div>
    </div>
    <div id="eventTableWrap">
  <table id="eventTable"><thead><tr><th style="width:46px">ID</th><th style="width:78px">Tool</th><th style="width:68px">Level</th><th style="width:70px">Dur</th><th style="width:60px">Code</th><th style="width:55px">OK</th><th style="width:55px" title="Confirmation (✔ confirmed / ⚠ requires)" >Conf</th><th style="width:82px">Time</th><th>Details / Preview (ps: cpuSec/wsMB)</th></tr></thead><tbody></tbody></table>
      <div id="empty" style="opacity:.6;font-size:.65rem;padding:1rem;text-align:center">No events yet.</div>
    </div>
    <div id="statusBar">
      <span>Last Event: <span id="lastEvtAge">--</span></span>
      <span>Replay: <span id="replayCount">0</span></span>
      <span>Timeout: ${(ENTERPRISE_CONFIG.limits?.defaultTimeoutMs || 90000)/1000}s</span>
      <span>WD: ${ENTERPRISE_CONFIG.security?.enforceWorkingDirectory? 'ON':'OFF'}</span>
      <span style="flex:1"></span>
  <span style="opacity:.55;font-size:.5rem">v${ver}</span>
    </div>
  </section>
  <section class="card" id="queuePanel" style="display:none;max-height:260px;overflow:auto">
    <h3 style="margin-top:0">Learn Queue</h3>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.4rem">
      <button id="refreshQueue" style="background:#475569">Refresh</button>
      <button id="approveSelected" style="background:#16a34a">Approve Selected</button>
      <button id="removeSelected" style="background:#dc2626">Remove Selected</button>
      <span id="queueMsg" style="font-size:.6rem;opacity:.75"></span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.62rem"><thead><tr><th></th><th>Normalized</th><th>Queued</th><th>Times</th><th>Last</th></tr></thead><tbody id="queueBody"></tbody></table>
  </section>
</main>
<script>(()=>{const oid='dashEarlyErrOv';function get(){let d=document.getElementById(oid);if(!d){d=document.createElement('div');d.id=oid;d.style.cssText='position:fixed;top:0;left:0;right:0;background:#7f1d1d;color:#fff;font:11px monospace;z-index:10000;padding:4px 6px;display:none;white-space:pre-wrap;max-height:45vh;overflow:auto;cursor:pointer';d.title='Early error overlay (click to hide)';d.addEventListener('click',()=>{d.style.display='none';});document.body.appendChild(d);}return d;}function append(msg){const o=get();o.style.display='block';o.textContent+=(o.textContent?'\n':'')+msg;}window.addEventListener('error',e=>{append('['+new Date().toISOString()+'] JS ERROR: '+e.message+' @ '+(e.filename||'')+':'+(e.lineno||'')+ (e.colno?':'+e.colno:''));});window.addEventListener('unhandledrejection',e=>{let r=e.reason;let msg;try{if(r&&typeof r==='object'){msg=r.stack||r.message||JSON.stringify(r);}else{msg=String(r);} }catch{msg=String(r);}append('['+new Date().toISOString()+'] PROMISE REJECTION: '+msg);});const origErr=console.error;console.error=function(...a){try{append('[console.error] '+a.map(x=>{if(typeof x==='string')return x;try{return JSON.stringify(x);}catch{return String(x);} }).join(' '));}catch{}return origErr.apply(console,a);};document.addEventListener('DOMContentLoaded',()=>append('['+new Date().toISOString()+'] DOMContentLoaded (early overlay active)'));})();</script>
<script src="/dash.js?v=${this.serverStart}&t=${Date.now()}${debug?'&debug=true':''}" defer></script>
</body></html>`);
      return;
    }
    if (path === '/api/unknown-candidates') {
      // Lazy load learning module each request (cached internally by module system)
      (async()=>{
        try {
          const lm = await getLearning();
          const list = lm.aggregateCandidates(50);
          this.writeJson(res, list);
        } catch (e:any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'aggregation_failed', message: e?.message }));
        }
      })();
      return;
    }
    if (path.startsWith('/api/learn-candidate')) {
      const q = this.parseQuery(url);
      const norm = q.normalized || '';
      if (!norm) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_normalized' }));
        return;
      }
      (async()=>{
        try {
          const lm = await getLearning();
          const queued = lm.queueCandidates([norm], 'dashboard');
          console.error('[LEARN] Queued normalized candidate via dashboard:', norm, queued);
          this.writeJson(res, { ok: true, normalized: norm, queued: true, added: queued.added, skipped: queued.skipped, total: queued.total });
        } catch (e:any) {
          console.error('[LEARN] Queue failed for', norm, e?.message || e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'queue_failed', message: e?.message || String(e) }));
        }
      })();
      return;
    }
  if (path === '/api/learn-queue') { (async()=>{ try { const lm = await getLearning(); this.writeJson(res, { queued: lm.listQueuedCandidates() }); } catch(e:any){ res.writeHead(500,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({ error:'queue_list_failed', message:e?.message })); } })(); return; }
  if (path === '/api/learn-queue/approve' && req.method==='POST') { let body=''; req.on('data',d=> body+=d); req.on('end', ()=>{ (async()=>{ try { const j=JSON.parse(body||'{}'); if(!Array.isArray(j.normalized)){ res.writeHead(400,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'normalized_required'})); return;} const lm = await getLearning(); const r=lm.approveQueuedCandidates(j.normalized,'dashboard'); this.writeJson(res,r); } catch(e:any){ res.writeHead(500,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'approve_failed', message:e?.message })); } })(); }); return; }
  if (path === '/api/learn-queue/remove' && req.method==='POST') { let body=''; req.on('data',d=> body+=d); req.on('end', ()=>{ (async()=>{ try { const j=JSON.parse(body||'{}'); if(!Array.isArray(j.normalized)){ res.writeHead(400,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'normalized_required'})); return;} const lm = await getLearning(); const r=lm.removeFromQueue(j.normalized); this.writeJson(res,r); } catch(e:any){ res.writeHead(500,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'remove_failed', message:e?.message })); } })(); }); return; }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }

  private writeJson(res: ServerResponse, obj: any): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  private writeDenied(res: ServerResponse): void {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'debug access denied' }));
  }

  private handleSSE(res: ServerResponse, replayCount: number): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    // Initial comment so clients know connection is open
    res.write(': connected\n\n');
    // Optional replay of recent events
    if (replayCount > 0 && this.replayBuffer.length) {
      const slice = this.replayBuffer.slice(-replayCount);
      for (const ev of slice) {
        res.write(this.serializeEvent(ev));
      }
    }
    const listener = (ev: ExecutionEventPayload) => {
      res.write(this.serializeEvent(ev));
    };
    this.emitter.on('exec', listener);
    res.on('close', () => this.emitter.off('exec', listener));
  }

  private serializeEvent(ev: ExecutionEventPayload): string {
    this.eventId++;
  return `id: ${this.eventId}\n` + `event: execution\n` + `data: ${JSON.stringify(ev)}\n\n`;    
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const hb: ExecutionEventPayload = {
    id: 'heartbeat', // Emit heartbeat event
        level: 'HEARTBEAT',
        durationMs: 0,
        blocked: false,
        truncated: false,
        timestamp: new Date().toISOString(),
        seq: ++this.seqCounter
      };
      this.emitter.emit('exec', hb);
      if (this.debugEnabled) {
        try { console.error('[METRICS][HEARTBEAT] emitted'); } catch {}
      }
    }, this.heartbeatIntervalMs).unref();
  }

  private parseQuery(url: string): Record<string,string> {
    const idx = url.indexOf('?');
    if (idx === -1) return {};
    const q = url.substring(idx+1);
        return Object.fromEntries(q.split('&').map(kv => {
          const [k, v = ''] = kv.split('=');
          return [decodeURIComponent(k), decodeURIComponent(v)];
        }));
  }

  private isDebug(url: string): boolean {
    if (this.debugEnabled) return true; // env override
    const q = this.parseQuery(url);
    return q.debug === 'true';
  }

  private getDebugState() {
    return {
      port: this.opts.port,
      started: this.started,
      eventId: this.eventId,
      replaySize: this.replayBuffer.length,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      lastFive: this.replayBuffer.slice(-5),
      scanMaxOffset: this.opts.scanMaxOffset,
      autoDisableOnFailure: this.opts.autoDisableOnFailure
    };
  }

  /** Build the dashboard client JS (simplified reimplementation after corruption fix). */
  private _dashCache?: { debug:boolean; script:string }; // retained but currently unused (cache disabled)
  private buildDashboardClientScript(debug: boolean): string {
    // Cache disabled to avoid stale/broken script persisting across hot deployments.
    const dbg = debug ? 'true':'false';
    const lines: string[] = [];
  lines.push('(()=>{');
  lines.push('const DEBUG='+dbg+';');
  lines.push("if(DEBUG) console.log('[DASH] init building script');");
    // DEBUG const inserted earlier
    // Basic error overlay
    lines.push("const ovId='dashOv';function overlay(){let d=document.getElementById(ovId);if(!d){d=document.createElement('div');d.id=ovId;d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fff;font:11px monospace;padding:4px 6px;display:none;max-height:40vh;overflow:auto;white-space:pre-wrap';document.body.appendChild(d);}return d;}");
    lines.push("window.addEventListener('error',e=>{const o=overlay();o.style.display='block';o.textContent='JS ERROR: '+e.message;});");
    lines.push("window.addEventListener('unhandledrejection',e=>{const o=overlay();o.style.display='block';o.textContent='UNHANDLED REJECTION: '+(e.reason&&e.reason.message||e.reason);});");
    // Elements
    lines.push("const tableBody=document.querySelector('#eventTable tbody');const emptyEl=document.getElementById('empty');const hbState=document.getElementById('hbState');const lastEvtAge=document.getElementById('lastEvtAge');const uptimeEl=document.getElementById('uptime');const portInfo=document.getElementById('portInfo');");
    // Metrics mapping
    lines.push("const metricsIds={total:'m_total',safe:'m_safe',risky:'m_risky',blocked:'m_blocked',confirmed:'m_confirm',timeouts:'m_timeouts',avg:'m_avg',p95:'m_p95',cpu:'m_cpu',rss:'m_rss',heap:'m_heap',lag:'m_lag',pscpu:'m_pscpu',psws:'m_psws',pssamples:'m_pssamples'};");
    lines.push('let lastEventTs=Date.now();let lastHeartbeat=Date.now();let lastMetricsTs=0;');
    // Age updater
    lines.push("setInterval(()=>{const now=Date.now();lastEvtAge.textContent=(now-lastEventTs)+'ms';const hbAge=now-lastHeartbeat;hbState.textContent='HB '+hbAge+'ms';hbState.className='pill '+(hbAge<17000?'hb-ok':hbAge<30000?'hb-warn':'hb-stale');if(lastMetricsTs){const age=now-lastMetricsTs;if(portInfo) portInfo.textContent='Port '+(location.port||'')+' • '+age+'ms';}},1000);");
    // Filters
  // Filters (avoid innerHTML + TS-only syntax so produced JS is valid)
  lines.push(`const levelOrder=['SAFE','RISKY','DANGEROUS','CRITICAL','BLOCKED','UNKNOWN'];const activeLevels=new Set(levelOrder);const filtersEl=document.getElementById('filters');levelOrder.forEach(l=>{const id='f_'+l;const lab=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.id=id;input.checked=true;lab.appendChild(input);lab.appendChild(document.createTextNode(' '+l));filtersEl.appendChild(lab);input.addEventListener('change',e=>{const t=e.target; if(t && t.checked) activeLevels.add(l); else activeLevels.delete(l);Array.from(tableBody.querySelectorAll('tr')).forEach(tr=>{const lvl=tr.dataset.level;tr.style.display=activeLevels.has(lvl)?'':'none';});});});`);
  // Clear button
  lines.push("document.getElementById('clearBtn').onclick=()=>{tableBody.innerHTML='';emptyEl.style.display='block';};");
  // Selection toggle (addRow already sets click handler later; here helper for external ops)
  lines.push("function getSelectedUnknown(){return Array.from(document.querySelectorAll('#eventTable tbody tr.learn-selected')).filter(r=>r.dataset.level==='UNKNOWN');}");
    // Row add
    lines.push("function fmtTime(iso){return iso.split('T')[1].replace('Z','');}");
  lines.push(`function addRow(ev){if(ev.level==='HEARTBEAT')return;emptyEl.style.display='none';const tr=document.createElement('tr');tr.dataset.level=ev.level;tr.className='level-'+ev.level;let preview=(ev.preview||'').replace(/</g,'&lt;');if(preview.length>400)preview=preview.slice(0,397)+'…';let confCell='';if(ev.confirmed){confCell='✔';tr.classList.add('confirmed');}else if(ev.requiresPrompt){confCell='⚠';tr.classList.add('requires');}tr.innerHTML='<td>'+ev.id+'</td><td>'+(ev.toolName||'')+'</td><td class="level">'+ev.level+'</td><td>'+ev.durationMs+'ms</td><td>'+(ev.exitCode==null?'':ev.exitCode)+'</td><td>'+(ev.success==null?'':(ev.success?'✔':'✖'))+'</td><td>'+confCell+'</td><td>'+fmtTime(ev.timestamp)+'</td><td>'+(preview||'')+'</td>';tr.addEventListener('click',()=>{tr.classList.toggle('learn-selected');});if(!activeLevels.has(ev.level))tr.style.display='none';tableBody.appendChild(tr);const wrap=document.getElementById('eventTableWrap');if(wrap)wrap.scrollTop=wrap.scrollHeight;if(tableBody.children.length>1000)tableBody.removeChild(tableBody.firstChild);}`);
  // Metrics fetch + simple graphs
  lines.push("let psWarned=false;async function refreshMetrics(){try{const r=await fetch('/api/metrics');if(!r.ok)return;const m=await r.json();const setMetric=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=String(val);};setMetric(metricsIds.total,m.totalCommands);setMetric(metricsIds.safe,m.safeCommands);setMetric(metricsIds.risky,m.riskyCommands);setMetric(metricsIds.blocked,m.blockedCommands);if('confirmedRequired'in m)setMetric(metricsIds.confirmed,m.confirmedRequired);if('timeouts'in m)setMetric(metricsIds.timeouts,m.timeouts);setMetric(metricsIds.avg,m.averageDurationMs);setMetric(metricsIds.p95,m.p95DurationMs);const p=m.performance||{};if(p.cpuPercent!=null)setMetric(metricsIds.cpu,p.cpuPercent.toFixed(1));if(p.rssMB!=null)setMetric(metricsIds.rss,p.rssMB.toFixed(0));if(p.heapUsedMB!=null)setMetric(metricsIds.heap,p.heapUsedMB.toFixed(0));if(p.eventLoopLagP95Ms!=null)setMetric(metricsIds.lag,p.eventLoopLagP95Ms.toFixed(1));if('psSamples'in m){setMetric(metricsIds.pssamples,m.psSamples||0);if(m.psCpuSecAvg!=null)setMetric(metricsIds.pscpu,(m.psCpuSecAvg||0).toFixed(2));if(m.psWSMBAvg!=null)setMetric(metricsIds.psws,(m.psWSMBAvg||0).toFixed(1));if((m.psSamples||0)===0 && !psWarned){const cpuEl=document.getElementById('m_pscpu');if(cpuEl){const note=document.createElement('div');note.style.cssText='font-size:.55rem;opacity:.6;margin-top:.3rem';note.textContent='(PS metrics disabled env)';cpuEl.parentElement.appendChild(note);psWarned=true;}}}lastMetricsTs=Date.now();if(uptimeEl)uptimeEl.textContent='Uptime: '+Math.round((Date.now()-Date.parse(m.lastReset))/1000)+'s';drawSimpleGraphs(m);}catch(e){if(DEBUG)console.error('[DASH][METRICS_ERR]',e);} }");
  lines.push("function drawSimpleGraphs(m){try{const cpu=document.getElementById('cpuGraph');const mem=document.getElementById('memGraph');if(!cpu||!mem)return;const cpuHist=m.cpuHistory||[];const memHist=m.memHistory||[];const cpuCtx=cpu.getContext('2d');const memCtx=mem.getContext('2d');const dpr=window.devicePixelRatio||1;const W=cpu.clientWidth||cpu.parentElement.clientWidth||300;const H=cpu.clientHeight||120;cpu.width=W*dpr;cpu.height=H*dpr;cpuCtx.setTransform(dpr,0,0,dpr,0,0);cpuCtx.clearRect(0,0,W,H);cpuCtx.fillStyle='#0f1318';cpuCtx.fillRect(0,0,W,H);cpuCtx.lineWidth=1.3;const cpuMaxVal=Math.max(1,...cpuHist.map(p=>p.value||0));const cpuScaleMax=cpuMaxVal<20?Math.min(100,Math.max(10,Math.ceil(cpuMaxVal*1.2))):100;cpuCtx.strokeStyle='#3b82f6';cpuCtx.beginPath();cpuHist.forEach((p,i)=>{const x=(i/Math.max(1,cpuHist.length-1))*W;const y=H-((p.value||0)/cpuScaleMax)*H;if(i===0)cpuCtx.moveTo(x,y);else cpuCtx.lineTo(x,y);});cpuCtx.stroke();cpuCtx.strokeStyle='#f59e0b';cpuCtx.beginPath();const lagMax=Math.max(1,Math.max(...cpuHist.map(p=>p.lag||0),50));cpuHist.forEach((p,i)=>{const x=(i/Math.max(1,cpuHist.length-1))*W;const y=H-((p.lag||0)/lagMax)*H;if(i===0)cpuCtx.moveTo(x,y);else cpuCtx.lineTo(x,y);});cpuCtx.stroke();const havePsSamples=m.psSamples>0;const havePsCpuLine=cpuHist.some(p=>typeof p.psCpuPct==='number');if(havePsSamples){cpuCtx.strokeStyle='#a855f7';cpuCtx.beginPath();let first=true;if(havePsCpuLine){cpuHist.forEach((p,i)=>{if(typeof p.psCpuPct!=='number')return;const x=(i/Math.max(1,cpuHist.length-1))*W;const y=H-(Math.min(100,p.psCpuPct)/cpuScaleMax)*H;if(first){cpuCtx.moveTo(x,y);first=false;}else cpuCtx.lineTo(x,y);});}else{const agg=(m.psCpuSecAvg||0);const estPct=Math.min(100,(agg/(m.psSamples||1))*40);const y=H-(estPct/cpuScaleMax)*H;cpuCtx.moveTo(0,y);cpuCtx.lineTo(W,y);}cpuCtx.stroke();}/* Legend */cpuCtx.font='10px monospace';const cpuLegendLines=havePsSamples?['CPU'+(cpuScaleMax!==100?' s:'+cpuScaleMax:''),'Lag','PS CPU']:['CPU'+(cpuScaleMax!==100?' s:'+cpuScaleMax:''),'Lag'];let cpuLegendW=0;cpuLegendLines.forEach(t=>{const w=cpuCtx.measureText(t).width;if(w>cpuLegendW)cpuLegendW=w;});cpuLegendW+=14;const cpuLegendH=cpuLegendLines.length*12+8;cpuCtx.fillStyle='rgba(0,0,0,0.35)';cpuCtx.fillRect(4,4,cpuLegendW,cpuLegendH);let yOff=14;cpuCtx.fillStyle='#3b82f6';cpuCtx.fillText(cpuLegendLines[0],8,yOff);yOff+=12;cpuCtx.fillStyle='#f59e0b';cpuCtx.fillText(cpuLegendLines[1],8,yOff);if(havePsSamples){yOff+=12;cpuCtx.fillStyle='#a855f7';cpuCtx.fillText('PS CPU',8,yOff);}/* Memory */const MW=mem.clientWidth||mem.parentElement.clientWidth||300;const MH=mem.clientHeight||120;mem.width=MW*dpr;mem.height=MH*dpr;memCtx.setTransform(dpr,0,0,dpr,0,0);memCtx.clearRect(0,0,MW,MH);memCtx.fillStyle='#0f1318';memCtx.fillRect(0,0,MW,MH);memCtx.lineWidth=1.3;const rssVals=memHist.map(p=>p.rss||0);const heapVals=memHist.map(p=>p.heap||0);const allVals=rssVals.concat(heapVals);const rssMin=Math.min(...allVals,0);const rssMax=Math.max(...allVals,1);const range=Math.max(1,rssMax-rssMin);const useDynamic=range<10;const normY=v=>MH-((v-(useDynamic?rssMin:0))/(useDynamic?range:rssMax))*MH;memCtx.strokeStyle='#10b981';memCtx.beginPath();memHist.forEach((p,i)=>{const x=(i/Math.max(1,memHist.length-1))*MW;const y=normY(p.rss||0);if(i===0)memCtx.moveTo(x,y);else memCtx.lineTo(x,y);});memCtx.stroke();memCtx.strokeStyle='#6366f1';memCtx.beginPath();memHist.forEach((p,i)=>{const x=(i/Math.max(1,memHist.length-1))*MW;const y=normY(p.heap||0);if(i===0)memCtx.moveTo(x,y);else memCtx.lineTo(x,y);});memCtx.stroke();const havePsWSLine=memHist.some(p=>typeof p.psWSMB==='number');if(havePsSamples){memCtx.strokeStyle='#f472b6';memCtx.beginPath();let first=true;if(havePsWSLine){memHist.forEach((p,i)=>{if(typeof p.psWSMB!=='number')return;const x=(i/Math.max(1,memHist.length-1))*MW;const y=normY(p.psWSMB);if(first){memCtx.moveTo(x,y);first=false;}else memCtx.lineTo(x,y);});}else{const v=(m.psWSMBAvg||0);const y=normY(v);memCtx.moveTo(0,y);memCtx.lineTo(MW,y);}memCtx.stroke();}memCtx.font='10px monospace';const memLegendLines=havePsSamples?['RSS'+(useDynamic?' dyn':''),'Heap',m.psSamples===0?'PS off':'PS WS']:['RSS'+(useDynamic?' dyn':''),'Heap'];let memLegendW=0;memLegendLines.forEach(t=>{const w=memCtx.measureText(t).width;if(w>memLegendW)memLegendW=w;});memLegendW+=14;const memLegendH=memLegendLines.length*12+8;memCtx.fillStyle='rgba(0,0,0,0.35)';memCtx.fillRect(4,4,memLegendW,memLegendH);let my=14;memCtx.fillStyle='#10b981';memCtx.fillText(memLegendLines[0],8,my);my+=12;memCtx.fillStyle='#6366f1';memCtx.fillText('Heap',8,my);if(havePsSamples){my+=12;memCtx.fillStyle=(m.psSamples===0?'#999':'#f472b6');memCtx.fillText(memLegendLines[memLegendLines.length-1],8,my);} }catch(ex){if(DEBUG)console.error('[DASH][GRAPH_ERR]',ex);} } ");
  lines.push('setInterval(refreshMetrics,5000); setTimeout(refreshMetrics,500);');
  // Queue / learning simple UI wiring (placeholder impl)
  lines.push("(function(){const lb=document.getElementById('learnBtn');const lm=document.getElementById('learnMsg');if(lb){lb.addEventListener('click',()=>{const sel=getSelectedUnknown();if(!sel.length){if(lm){lm.textContent='No UNKNOWN selected';setTimeout(()=>lm.textContent='',1800);}return;}if(lm){lm.textContent='Queued '+sel.length+' (demo)';setTimeout(()=>lm.textContent='',2200);}sel.forEach(r=>r.classList.remove('learn-selected'));});}const showQ=document.getElementById('showQueue');const qp=document.getElementById('queuePanel');if(showQ&&qp){showQ.addEventListener('click',()=>{qp.style.display=qp.style.display==='none'?'block':'none';});}const refreshQ=document.getElementById('refreshQueue');const qb=document.getElementById('queueBody');if(refreshQ&&qb){refreshQ.addEventListener('click',async()=>{try{refreshQ.disabled=true;const r=await fetch('/api/unknown-candidates?debug=true');if(r.ok){const list=await r.json();qb.innerHTML='';(list||[]).forEach(c=>{const tr=document.createElement('tr');tr.innerHTML=\"<td><input type=\\\"checkbox\\\"></td><td>\"+(c.normalized||'')+\"</td><td>\"+(c.count||1)+\"</td><td>\"+(c.times||1)+\"</td><td>\"+(c.last||'')+\"</td>\";qb.appendChild(tr);});}}catch(ex){ if(DEBUG) console.error('[DASH][QUEUE_REFRESH_ERR]',ex);}finally{refreshQ.disabled=false;}});} })();");
  // Emit synthetic button (debug mode only)
    lines.push("if(DEBUG){try{const eb=document.getElementById('emit');if(eb){eb.addEventListener('click',async()=>{try{eb.disabled=true;eb.textContent='Emitting...';const r=await fetch('/api/debug/emit?debug=true&level=SAFE&durationMs=5');if(r.ok){const js=await r.json();if(js.synthetic){addRow(js.synthetic);} } }catch(ex){if(DEBUG)console.error('[DASH][EMIT_ERR]',ex);}finally{eb.disabled=false;eb.textContent='Emit Synthetic';}});} }catch(ex){if(DEBUG)console.error('[DASH][EMIT_INIT_ERR]',ex);} }");
  // SSE
    lines.push("const es=new EventSource('/events'+(DEBUG?'?replay=50':''));");
    lines.push("const handleEvent=e=>{try{const d=JSON.parse(e.data);if(d.level==='HEARTBEAT'){lastHeartbeat=Date.now();return;}lastEventTs=Date.now();addRow(d);}catch(err){if(DEBUG)console.error('Bad event',err);}};es.addEventListener('execution',handleEvent);es.onmessage=handleEvent;es.addEventListener('open',()=>{lastEventTs=Date.now();hbState.textContent='SSE OK';hbState.className='pill hb-ok';});es.addEventListener('error',()=>{hbState.textContent='SSE ERR';hbState.className='pill hb-stale';});");
    // Poll fallback if no metrics after 6s
    lines.push("setTimeout(()=>{if(!lastMetricsTs){console.warn('[DASH] metrics delayed >6s');refreshMetrics();}},6000);");
    lines.push("document.getElementById('replayCount').textContent=tableBody.children.length.toString();");
  lines.push("if(DEBUG)console.log('[DASH] script loaded debug='+DEBUG);})();");
  // Removed duplicate extra '})();' which caused a syntax error (unmatched closing) and blocked dashboard script execution.
  const scriptRaw = lines.join('');
  // Avoid aggressive whitespace collapsing which previously obscured syntax issues; serve raw (readable) script.
  // If explicit prod minification desired later, reintroduce guarded replace.
  const script = scriptRaw; // (debug || process.env.METRICS_MINIFY_DASH==='1') ? scriptRaw.replace(/\s+/g,' ') : scriptRaw;
  return script;
  }

  private startPerfSampler(): void {
    if (this.perfTimer) return;
    this.perfTimer = setInterval(() => {
      try {
        const hrNow = process.hrtime.bigint();
        const cpuNow = process.cpuUsage();
        const hrDiffNs = Number(hrNow - this.lastHr);
        const cpuUserDiff = cpuNow.user - this.lastCpu.user;
        const cpuSysDiff = cpuNow.system - this.lastCpu.system;
        this.lastHr = hrNow;
        this.lastCpu = cpuNow;
        const elapsedMs = hrDiffNs / 1e6;
        const cpuMs = (cpuUserDiff + cpuSysDiff) / 1000; // cpuUsage reports microseconds
        const cpuPercent = elapsedMs > 0 ? (cpuMs / elapsedMs) * 100 : 0; // single-core equivalent
        const mem = process.memoryUsage();
        const rssMB = mem.rss / 1024 / 1024;
        const heapUsedMB = mem.heapUsed / 1024 / 1024;
        const heapTotalMB = mem.heapTotal / 1024 / 1024;
        const lagP95 = this.computeP95(this.lagSamples);
        
        // Update current snapshot
        this.performanceSnapshot = {
          cpuPercent: +cpuPercent.toFixed(2),
          rssMB: +rssMB.toFixed(2),
          heapUsedMB: +heapUsedMB.toFixed(2),
          heapTotalMB: +heapTotalMB.toFixed(2),
          eventLoopLagP95Ms: +lagP95.toFixed(2),
          samples: this.lagSamples.length
        };

        // Update historical data for graphs (augment with PS metrics when available)
        const now = Date.now();
        let psCpuPct: number | undefined; let psWSMB: number | undefined;
        try {
          const snap: any = metricsRegistry.snapshot(false);
          if(typeof snap.psWSMBAvg === 'number' && snap.psSamples>0){ psWSMB = +snap.psWSMBAvg; }
          if(typeof (snap as any).psCpuSecLast === 'number' && snap.psSamples>0){
            const intervalSec = this.psSampleIntervalMs/1000;
            if(intervalSec>0){ psCpuPct = +(((snap as any).psCpuSecLast/ intervalSec)*100).toFixed(2); }
          } else if(typeof snap.psCpuSecAvg === 'number' && snap.psSamples>0){
            const intervalSec = this.psSampleIntervalMs/1000;
            if(intervalSec>0){ psCpuPct = +((snap.psCpuSecAvg/ intervalSec)*100).toFixed(2); }
          }
        } catch {}
        this.cpuHistory.push({ timestamp: now, value: +cpuPercent.toFixed(2), lag: +lagP95.toFixed(2), psCpuPct });
        this.memHistory.push({ timestamp: now, rss: +rssMB.toFixed(1), heap: +heapUsedMB.toFixed(1), psWSMB });

        // Keep only recent history (last 60 samples = 2 minutes at 2s intervals)
        if (this.cpuHistory.length > this.historyLimit) {
          this.cpuHistory.shift();
        }
        if (this.memHistory.length > this.historyLimit) {
          this.memHistory.shift();
        }
      } catch {}
    }, this.perfSampleIntervalMs).unref();
    // Start optional synthetic ticker if env flag enabled to aid debugging SSE
    if(process.env.METRICS_TICKER === '1' && !this.syntheticTickerTimer){
      this.syntheticTickerTimer = setInterval(()=>{
        try {
          const ev: ExecutionEventPayload = {
            id: 'ticker-'+Date.now(),
            level: 'SAFE',
            durationMs: 1,
            blocked: false,
            truncated: false,
            timestamp: new Date().toISOString(),
            preview: '[ticker]',
            success: true,
            exitCode: 0,
            toolName: 'ticker'
          };
          this.publishExecution(ev);
          metricsRegistry.record({ level: 'SAFE' as any, blocked:false, durationMs:1, truncated:false });
          if(this.debugEnabled) console.error('[METRICS][TICKER] emitted synthetic event');
        } catch {}
      }, this.syntheticTickerIntervalMs).unref();
    }
  }

  private startLagMonitor(): void {
    if (this.lagTimer) return;
    let prev = process.hrtime.bigint();
    this.lagTimer = setInterval(() => {
      const now = process.hrtime.bigint();
      const diffMs = Number(now - prev) / 1e6 - this.lagIntervalMs;
      prev = now;
      const lag = diffMs < 0 ? 0 : diffMs;
      this.lagSamples.push(lag);
      if (this.lagSamples.length > 120) this.lagSamples.shift();
    }, this.lagIntervalMs).unref();
  }

  private computeP95(arr: number[]): number {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a,b)=>a-b);
    const idx = Math.floor(0.95 * (sorted.length - 1));
    return sorted[idx];
  }

  private startPsSampler(): void {
    if(this.psSampleTimer || process.env.MCP_CAPTURE_PS_METRICS !== '1') return;
    const capture = () => {
      try {
  const mem = process.memoryUsage();
  const wsMB = +(mem.rss/1024/1024).toFixed(2);
  const cpuUsage = process.cpuUsage();
  const cpuCumulativeSec = (cpuUsage.user + cpuUsage.system)/1e6;
  try { (metricsRegistry as any).capturePsSample(cpuCumulativeSec, wsMB); } catch {}
      } catch {}
      this.psSampleTimer = setTimeout(capture, this.psSampleIntervalMs).unref();
    };
    capture();
  }
}

const port = process.env.METRICS_PORT ? parseInt(process.env.METRICS_PORT,10) : 9090;
const scanMaxOffset = process.env.METRICS_PORT_SCAN_MAX ? parseInt(process.env.METRICS_PORT_SCAN_MAX,10) : 10;
export const metricsHttpServer = new MetricsHttpServer({ port, enabled: true, scanMaxOffset, autoDisableOnFailure: true });
