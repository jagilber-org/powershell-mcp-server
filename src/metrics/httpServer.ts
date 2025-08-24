/**
 * Phase 2: Internal HTTP Metrics & Dashboard Server (scaffold)
 * Minimal dependencies: using native http module to avoid bloat.
 * Endpoints:
 *  - /healthz : liveness
 *  - /readyz  : readiness (server started)
 *  - /metr  tr.level-SAFE td.level{color:var(--safe)}
  tr.level-RISKY td.level{color:var(--risky)}
  tr.level-DANGEROUS td.level{color:var(--danger)}
  tr.level-CRITICAL td.level{color:var(--danger)}
  tr.level-BLOCKED td.level{color:var(--blocked)}
  tr.level-UNKNOWN td.level{color:var(--unknown)}
  tr.confirmed{background:rgba(255, 215, 0, 0.1);border-left:3px solid #ffd700}
  .bad{color:var(--danger)} .warn{color:var(--risky)} .good{color:var(--safe)}imple Prometheus-style exposition (subset)
 *  - /api/metrics : JSON snapshot
 *  - /events  : Server-Sent Events stream of executions (security redactions applied upstream)
 */
import * as http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { metricsRegistry } from './registry.js';
import { EventEmitter } from 'events';
import * as os from 'os';
import { aggregateCandidates, queueCandidates, listQueuedCandidates, approveQueuedCandidates, removeFromQueue } from '../learning.js';
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
  // Optional rich details
  preview?: string;        // partial command / script text
  exitCode?: number | null;
  success?: boolean;
  confirmed?: boolean;     // whether this was a confirmed command
  timedOut?: boolean;      // whether the execution timed out
  candidateNorm?: string;  // normalized UNKNOWN candidate (learning)
  toolName?: string;       // originating tool name (for non-powershell tool activity logging)
}

export class MetricsHttpServer {
  private server?: http.Server;
  private opts: MetricsHttpOptions;
  private started = false;
  private emitter = new EventEmitter();
  private eventId = 0;
  private heartbeatIntervalMs = 15000;
  private heartbeatTimer?: NodeJS.Timeout;
  private replayBuffer: ExecutionEventPayload[] = [];
  private replayLimit = 200; // cap buffer size
  private debugEnabled = process.env.METRICS_DEBUG === 'true';
  // Performance sampling
  private perfTimer?: NodeJS.Timeout;
  private perfSampleIntervalMs = 2000;
  private lastCpu = process.cpuUsage();
  private lastHr = process.hrtime.bigint();
  private lagSamples: number[] = [];
  private lagTimer?: NodeJS.Timeout;
  private lagIntervalMs = 500;
  private performanceSnapshot: any = {};
  // Historical data for graphs
  // Store CPU percent and event loop lag (ms) together for combined graph
  private cpuHistory: Array<{timestamp: number, value: number, lag: number}> = [];
  private memHistory: Array<{timestamp: number, rss: number, heap: number}> = [];
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
        // eslint-disable-next-line no-console
  const proto = 'http'; // internal loopback; no external exposure
  console.error(`[METRICS] HTTP server listening on ${proto}://${host}:${attemptPort}`);
        this.opts.port = attemptPort; // record chosen
        this.startHeartbeat();
  this.startPerfSampler();
  this.startLagMonitor();
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
  }

  publishExecution(ev: ExecutionEventPayload): void {
  // store in ring buffer
  this.replayBuffer.push(ev);
  if (this.replayBuffer.length > this.replayLimit) this.replayBuffer.shift();
    this.emitter.emit('exec', ev);
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
  const rawUrl = req.url || '/';
  const url = rawUrl; // keep original for query parsing where needed
  const path = rawUrl.split('?')[0];
  if (path === '/healthz') {
      this.writeJson(res, { status: 'ok' });
      return;
    }
  if (path === '/readyz') {
      this.writeJson(res, { status: this.started ? 'ready' : 'starting' });
      return;
    }
  if (path === '/api/metrics') {
      const snap = metricsRegistry.snapshot(false);
  const perf = this.performanceSnapshot;
  // Include historical data for graphs
  const response = { 
    ...snap, 
    performance: perf,
    cpuHistory: this.cpuHistory,
    memHistory: this.memHistory
  };
  this.writeJson(res, response);
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
          level: synthetic.level as any,
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
    if (path === '/' || path.startsWith('/dashboard')) {
      const debug = this.isDebug(url);
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
  tr.learn-selected{outline:2px solid #6366f1; box-shadow:0 0 0 2px #6366f1 inset; position:relative;}
  tr.learn-selected:after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(99,102,241,.15),rgba(99,102,241,0));}
  .bad{color:var(--danger)} .warn{color:var(--risky)} .good{color:var(--safe)}
  #filters{display:flex;flex-wrap:wrap;gap:.6rem;margin-bottom:.6rem}
  #filters label{display:flex;align-items:center;gap:.25rem;font-size:.62rem;padding:.25rem .45rem;border:1px solid var(--border);border-radius:6px;background:var(--panel-alt);cursor:pointer;user-select:none}
  #filters input{margin:0}
  #statusBar{display:flex;gap:.75rem;align-items:center;font-size:.65rem;margin-top:.4rem;font-family:var(--mono);opacity:.8}
  .hb-ok{color:var(--safe)} .hb-warn{color:var(--risky)} .hb-stale{color:var(--danger)}
  a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
  button{background:var(--accent);color:#fff;border:none;padding:.45rem .75rem;font-size:.65rem;border-radius:6px;cursor:pointer;font-weight:600;letter-spacing:.5px}button:hover{filter:brightness(1.1)}
  #controls{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.6rem}
  #empty{opacity:.6;font-size:.65rem;padding:1rem;text-align:center}
  canvas{display:block;width:100%;height:100%}
  @media (min-width:1000px){main{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}}
  ::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:#12161c}::-webkit-scrollbar-thumb{background:#303b46;border-radius:8px}::-webkit-scrollbar-thumb:hover{background:#3d4955}
</style>
</head><body>
<header>
  <h1>PowerShell MCP Dashboard ${debug?'<span class="pill debug">DEBUG</span>':''}</h1>
  <span class="pill" id="portInfo">Port: ${this.opts.port}</span>
  <span class="pill" id="hbState">HB: --</span>
  <span class="pill" id="uptime">Uptime: --</span>
  <span style="flex:1"></span>
  <a class="pill" href="/metrics" target="_blank">Prometheus</a>
  <a class="pill" href="/api/metrics" target="_blank">/api/metrics</a>
  ${debug?'<a class="pill" href="/api/debug?debug=true" target="_blank">Debug JSON</a>':''}
</header>
<main>
  <div id="statsGrid">
    <section class="card"><h3>Total</h3><div class="metric" id="m_total">0</div></section>
    <section class="card"><h3>SAFE</h3><div class="metric" id="m_safe">0</div></section>
    <section class="card"><h3>RISKY</h3><div class="metric" id="m_risky">0</div></section>
    <section class="card"><h3>BLOCKED</h3><div class="metric" id="m_blocked">0</div></section>
    <section class="card"><h3>CONFIRM?</h3><div class="metric" id="m_confirm">0</div></section>
  <section class="card"><h3>TIMEOUTS</h3><div class="metric" id="m_timeouts">0</div></section>
    <section class="card"><h3>AVG ms</h3><div class="metric" id="m_avg">0</div></section>
    <section class="card"><h3>P95 ms</h3><div class="metric" id="m_p95">0</div></section>
    <section class="card"><h3>CPU%</h3><div class="metric" id="m_cpu">0</div></section>
    <section class="card"><h3>RSS MB</h3><div class="metric" id="m_rss">0</div></section>
    <section class="card"><h3>HEAP MB</h3><div class="metric" id="m_heap">0</div></section>
    <section class="card"><h3>LOOP LAG</h3><div class="metric" id="m_lag">0</div></section>
    <section class="card grid-full" id="cpuGraphCard">
      <h3>CPU % (Last 2 minutes)</h3>
      <div id="cpuGraphContainer" style="position:relative;height:120px;border:1px solid #333;background:#111">
        <canvas id="cpuGraph" style="width:100%;height:100%"></canvas>
      </div>
    </section>
    <section class="card grid-full" id="memGraphCard">
      <h3>Memory (MB - Last 2 minutes)</h3>
      <div id="memGraphContainer" style="position:relative;height:120px;border:1px solid #333;background:#111">
        <canvas id="memGraph" style="width:100%;height:100%"></canvas>
      </div>
    </section>
  </div>
  <section class="card" id="eventsPanel">
      <div id="controls">
        <div id="filters"></div>
        <button id="clearBtn" title="Clear visible events">Clear</button>
        ${debug?'<button id="emit">Emit Synthetic</button>':''}
      </div>
      <div id="eventTableWrap">
  <table id="eventTable"><thead><tr><th style="width:46px">ID</th><th style="width:78px">Tool</th><th style="width:68px">Level</th><th style="width:70px">Dur</th><th style="width:60px">Code</th><th style="width:55px">OK</th><th style="width:82px">Time</th><th>Details / Preview</th></tr></thead><tbody></tbody></table>
        <div id="empty">No events yet.</div>
      </div>
      <div id="statusBar">
        <span>Last Event: <span id="lastEvtAge">--</span></span>
        <span>Replay Applied: <span id="replayCount">0</span></span>
        <span>Default Timeout: ${(ENTERPRISE_CONFIG.limits?.defaultTimeoutMs || 90000)/1000}s</span>
        <span>WD Enf: ${ENTERPRISE_CONFIG.security?.enforceWorkingDirectory? 'ON':'OFF'}</span>
        <span style="flex:1"></span>
        <button id="learnBtn" title="Queue selected UNKNOWN row for review" style="background:#6366f1">Queue Selected</button>
        <span id="learnMsg" style="font-size:.6rem;opacity:.75"></span>
        <button id="showQueue" style="background:#374151">Queue Panel</button>
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
<script>
(()=>{
  const debug = ${debug? 'true':'false'};
  const filtersEl = document.getElementById('filters');
  const tableBody = document.querySelector('#eventTable tbody');
  const emptyEl = document.getElementById('empty');
  const hbState = document.getElementById('hbState');
  const lastEvtAge = document.getElementById('lastEvtAge');
  const replayCountEl = document.getElementById('replayCount');
  const uptimeEl = document.getElementById('uptime');
  const learnBtn = document.getElementById('learnBtn');
  const learnMsg = document.getElementById('learnMsg');
  const queuePanel = document.getElementById('queuePanel');
  const showQueueBtn = document.getElementById('showQueue');
  const queueBody = document.getElementById('queueBody');
  const queueMsg = document.getElementById('queueMsg');
  const refreshQueueBtn = document.getElementById('refreshQueue');
  const approveSelectedBtn = document.getElementById('approveSelected');
  const removeSelectedBtn = document.getElementById('removeSelected');
  let selectedCandidate = null; // normalized
  let selectedRow = null;
  const metricsIds = { total:'m_total', safe:'m_safe', risky:'m_risky', blocked:'m_blocked', confirm:'m_confirm', timeouts:'m_timeouts', avg:'m_avg', p95:'m_p95', cpu:'m_cpu', rss:'m_rss', heap:'m_heap', lag:'m_lag'};
  const levelOrder = ['SAFE','RISKY','DANGEROUS','CRITICAL','BLOCKED','UNKNOWN'];
  const activeLevels = new Set(levelOrder);
  let lastEventTs = Date.now();
  let lastHeartbeat = Date.now();
  let replayApplied=0;
  let cpuChart = null;
  let memChart = null;
  function fmtTime(iso){return iso.split('T')[1].replace('Z','');}
  function updateAge(){ const age=Date.now()-lastEventTs; lastEvtAge.textContent = age+'ms'; const hbAge = Date.now()-lastHeartbeat; hbState.textContent = 'HB '+hbAge+'ms'; hbState.className='pill '+(hbAge<17000?'hb-ok':hbAge<30000?'hb-warn':'hb-stale'); }
  setInterval(updateAge,1000);
  // Filters UI
  levelOrder.forEach(l=>{ const id='f_'+l; const lab=document.createElement('label'); lab.innerHTML='<input type="checkbox" id="'+id+'" checked /> '+l; filtersEl.appendChild(lab); lab.querySelector('input').addEventListener('change',e=>{ if(e.target.checked) activeLevels.add(l); else activeLevels.delete(l); Array.from(tableBody.querySelectorAll('tr')).forEach(tr=>{ if(!activeLevels.has(tr.dataset.level)) tr.style.display='none'; else tr.style.display=''; }); }); });
  // Clear
  document.getElementById('clearBtn').onclick=()=>{ tableBody.innerHTML=''; emptyEl.style.display='block'; };
  function addRow(ev){ 
    if(ev.level==='HEARTBEAT') return; 
    emptyEl.style.display='none'; 
  const tr=document.createElement('tr'); 
    tr.dataset.level=ev.level; 
    tr.className='level-'+ev.level; 
  if(ev.candidateNorm) tr.dataset.candidate=ev.candidateNorm;
    
    // Check if this was a confirmed command
    const preview=(ev.preview||'').replace(/</g,'&lt;'); 
    const isConfirmed = ev.confirmed === true;
    if (isConfirmed) {
      tr.classList.add('confirmed');
    }
    
    if(!activeLevels.has(ev.level)) tr.style.display='none'; 
    
    const markers = [];
  if (ev.blocked) markers.push('<span style="color:#ff5f56;font-weight:600">BLOCKED</span>');
  if (ev.truncated) markers.push('<span style="color:#ffa500">TRUNC</span>');
  if (ev.timedOut) markers.push('<span style="color:#ff00ff">TIMEOUT</span>');
    if (isConfirmed) markers.push('<span style="background:#ffd700;color:#111;padding:2px 4px;border-radius:4px;font-size:.55rem;font-weight:600;letter-spacing:.5px">CONFIRMED</span>');
    tr.innerHTML='<td>'+ev.id+'</td>'+
      '<td>'+(ev.toolName||'')+'</td>'+
      '<td class="level">'+ev.level+'</td>'+
      '<td>'+ev.durationMs+'ms</td>'+
      '<td>'+(ev.exitCode===undefined||ev.exitCode===null?'':ev.exitCode)+'</td>'+
      '<td>'+(ev.success===undefined?'':(ev.success?'✔':'✖'))+'</td>'+
      '<td>'+fmtTime(ev.timestamp)+'</td>'+
      '<td>'+ (markers.length?markers.join(' ')+' ':'') + (preview?preview:'') +'</td>';
    
    // Row click selection for UNKNOWN learning
    tr.addEventListener('click', (e)=>{
      if(!tr.dataset.candidate) return; // only unknown
      e.stopPropagation();
      if(selectedRow && selectedRow!==tr) selectedRow.classList.remove('learn-selected');
      selectedCandidate = tr.dataset.candidate;
      tr.classList.add('learn-selected');
      selectedRow = tr;
      learnMsg.textContent='Selected '+selectedCandidate;
      // Keep message until another action
    });
    tableBody.appendChild(tr); 
    
    // Auto-scroll to bottom
    const tableWrap = document.getElementById('eventTableWrap');
    if (tableWrap) {
      tableWrap.scrollTop = tableWrap.scrollHeight;
    }
    
    if(tableBody.children.length>1000) tableBody.removeChild(tableBody.firstChild); 
  }
  async function refreshMetrics(){
    try{
      const r= await fetch('/api/metrics'); if(!r.ok) return; const m= await r.json();
      document.getElementById(metricsIds.total).textContent=m.totalCommands;
      document.getElementById(metricsIds.safe).textContent=m.safeCommands;
      document.getElementById(metricsIds.risky).textContent=m.riskyCommands;
      document.getElementById(metricsIds.blocked).textContent=m.blockedCommands;
  document.getElementById(metricsIds.avg).textContent=m.averageDurationMs;
  if('confirmationRequired' in m) document.getElementById(metricsIds.confirm).textContent=m.confirmationRequired;
  document.getElementById(metricsIds.p95).textContent=m.p95DurationMs;
  if('timeouts' in m) document.getElementById(metricsIds.timeouts).textContent=m.timeouts;
      const p=m.performance||{};
      if('cpuPercent'in p) document.getElementById(metricsIds.cpu).textContent=p.cpuPercent.toFixed(1);
      if('rssMB'in p) document.getElementById(metricsIds.rss).textContent=p.rssMB.toFixed(0);
      if('heapUsedMB'in p) document.getElementById(metricsIds.heap).textContent=p.heapUsedMB.toFixed(0);
      if('eventLoopLagP95Ms'in p) document.getElementById(metricsIds.lag).textContent=p.eventLoopLagP95Ms.toFixed(1);
      uptimeEl.textContent='Uptime: '+Math.round((Date.now()-Date.parse(m.lastReset))/1000)+'s';
      
      // Update graphs with historical data
      if (m.cpuHistory && m.cpuHistory.length > 0) {
        updateCpuGraph(m.cpuHistory);
      }
      if (m.memHistory && m.memHistory.length > 0) {
        updateMemGraph(m.memHistory);
      }
    }catch{}
  }

  // Simple graph drawing functions
  function updateCpuGraph(data) {
    const canvas = document.getElementById('cpuGraph');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    if (!data || data.length === 0) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Find max value for scaling (consider both cpu percent and lag ms). Avoid very low scale.
    const maxCpu = Math.max(...data.map(d => d.value), 0);
    const maxLag = Math.max(...data.map(d => (d.lag ?? 0)), 0);
    const maxValue = Math.max(10, maxCpu, maxLag);
    const padding = 10;
    const graphWidth = canvas.width - 2 * padding;
    const graphHeight = canvas.height - 2 * padding;
    
    // Draw grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (i * graphHeight / 5);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
    }
    
    // Draw CPU line
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((point, index) => {
      const x = padding + (index * graphWidth / (data.length - 1));
      const y = canvas.height - padding - (point.value * graphHeight / maxValue);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw Lag line (magenta)
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((point, index) => {
      const lagVal = point.lag ?? 0;
      const x = padding + (index * graphWidth / (data.length - 1));
      const y = canvas.height - padding - (lagVal * graphHeight / maxValue);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Legend & current values
    if (data.length > 0) {
      const last = data[data.length - 1];
      ctx.font = '10px monospace';
      ctx.fillStyle = '#00ff00';
      ctx.fillText('CPU: ' + last.value.toFixed(1) + '%', padding + 2, padding + 12);
      ctx.fillStyle = '#ff00ff';
      ctx.fillText('Lag: ' + (last.lag ?? 0).toFixed(1) + 'ms', padding + 2, padding + 24);
      ctx.fillStyle = '#888';
      ctx.fillText('Max Axis: ' + maxValue.toFixed(1), padding + 2, padding + 36);
    }
  }
  
  function updateMemGraph(data) {
    const canvas = document.getElementById('memGraph');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    if (!data || data.length === 0) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Find max values for scaling
    const maxRss = Math.max(...data.map(d => d.rss));
    const maxHeap = Math.max(...data.map(d => d.heap));
    const maxValue = Math.max(maxRss, maxHeap);
    
    const padding = 10;
    const graphWidth = canvas.width - 2 * padding;
    const graphHeight = canvas.height - 2 * padding;
    
    // Draw grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (i * graphHeight / 5);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
    }
    
    // Draw RSS line (blue)
    ctx.strokeStyle = '#0088ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((point, index) => {
      const x = padding + (index * graphWidth / (data.length - 1));
      const y = canvas.height - padding - (point.rss * graphHeight / maxValue);
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
    
    // Draw Heap line (orange)
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((point, index) => {
      const x = padding + (index * graphWidth / (data.length - 1));
      const y = canvas.height - padding - (point.heap * graphHeight / maxValue);
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
    
    // Draw legend
    if (data.length > 0) {
      const lastRss = data[data.length - 1].rss;
      const lastHeap = data[data.length - 1].heap;
      
      ctx.fillStyle = '#0088ff';
      ctx.font = '10px monospace';
      ctx.fillText('RSS: ' + lastRss.toFixed(1) + 'MB', padding + 2, padding + 12);
      
      ctx.fillStyle = '#ff8800';
      ctx.fillText('Heap: ' + lastHeap.toFixed(1) + 'MB', padding + 2, padding + 24);
      
      ctx.fillStyle = '#888';
      ctx.fillText('Max: ' + maxValue.toFixed(1) + 'MB', padding + 2, padding + 36);
    }
  }
  setInterval(refreshMetrics,5000); refreshMetrics();
  const es = new EventSource('/events'+(debug?'?replay=50':''));
  const handleEvent = e => { try{ const d=JSON.parse(e.data); if(d.level==='HEARTBEAT'){ lastHeartbeat=Date.now(); return; } lastEventTs=Date.now(); addRow(d); }catch(err){ console.error('Bad event', err); } };
  // Support both default and custom event names
  es.onmessage = handleEvent;            // if server sends default events
  es.addEventListener('execution', handleEvent); // current server uses 'event: execution'
  es.addEventListener('open',()=>{ lastEventTs=Date.now(); });
  es.onerror = () => { hbState.textContent='SSE ERROR'; hbState.className='pill hb-stale'; };
  // Count replayed by observing first N ids quickly
  setTimeout(()=>{ replayCountEl.textContent = tableBody.children.length; },1000);
  if(debug){ document.getElementById('emit').onclick=()=>{ fetch('/api/debug/emit?debug=true&level=SAFE&durationMs='+(Math.random()*60|0)).then(r=>r.json()).then(j=>{ addRow(j.synthetic); }); }; }

  function renderQueue(items){
    queueBody.innerHTML='';
    if(!items || !items.length){ queueBody.innerHTML='<tr><td colspan=5 style="opacity:.6">Empty</td></tr>'; return; }
    items.forEach(it=>{
      const tr=document.createElement('tr');
      tr.innerHTML='<td><input type="checkbox" data-norm="'+it.normalized+'" /></td>'+
        '<td style="font-family:monospace">'+it.normalized+'</td>'+
        '<td>'+(it.added||'').replace('T',' ').split('.')[0]+'</td>'+
        '<td style="text-align:right">'+(it.timesQueued||1)+'</td>'+
        '<td>'+(it.lastQueued||'').replace('T',' ').split('.')[0]+'</td>';
      queueBody.appendChild(tr);
    });
  }
  async function loadQueue(){ try{ const r=await fetch('/api/learn-queue'); if(!r.ok) return; const j=await r.json(); renderQueue(j.queued||[]);}catch{} }
  if(showQueueBtn){ showQueueBtn.addEventListener('click', ()=>{ queuePanel.style.display = queuePanel.style.display==='none'?'block':'none'; if(queuePanel.style.display==='block') loadQueue(); }); }
  if(refreshQueueBtn){ refreshQueueBtn.addEventListener('click', loadQueue); }
  if(approveSelectedBtn){ approveSelectedBtn.addEventListener('click', async ()=>{ const norms = Array.from(queueBody.querySelectorAll('input[type=checkbox]:checked')).map(cb=>cb.getAttribute('data-norm')); if(!norms.length){ queueMsg.textContent='Select entries'; setTimeout(()=>queueMsg.textContent='',2500); return; } queueMsg.textContent='Approving…'; try{ const r=await fetch('/api/learn-queue/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({normalized:norms})}); const j=await r.json(); if(r.ok){ queueMsg.textContent='Promoted '+j.promoted; loadQueue(); } else { queueMsg.textContent='Error '+(j.error||r.status); } }catch{ queueMsg.textContent='Network error'; } setTimeout(()=>queueMsg.textContent='',4000); }); }
  if(removeSelectedBtn){ removeSelectedBtn.addEventListener('click', async ()=>{ const norms = Array.from(queueBody.querySelectorAll('input[type=checkbox]:checked')).map(cb=>cb.getAttribute('data-norm')); if(!norms.length){ queueMsg.textContent='Select entries'; setTimeout(()=>queueMsg.textContent='',2500); return; } queueMsg.textContent='Removing…'; try{ const r=await fetch('/api/learn-queue/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({normalized:norms})}); const j=await r.json(); if(r.ok){ queueMsg.textContent='Removed '+j.removed; loadQueue(); } else { queueMsg.textContent='Error '+(j.error||r.status); } }catch{ queueMsg.textContent='Network error'; } setTimeout(()=>queueMsg.textContent='',4000); }); }
  if(learnBtn){ learnBtn.addEventListener('click', async ()=>{ if(!selectedCandidate){ learnMsg.textContent='Select an UNKNOWN row first'; setTimeout(()=>{ if(learnMsg.textContent.startsWith('Select')) learnMsg.textContent=''; },3000); return; } const normalized=selectedCandidate; learnBtn.disabled=true; learnBtn.textContent='Queuing…'; learnMsg.textContent=''; try{ const r=await fetch('/api/learn-candidate?normalized='+encodeURIComponent(normalized), {method:'POST'}); const j=await r.json(); if(r.ok){ learnMsg.textContent='Queued: '+(j.normalized||normalized); loadQueue(); } else { learnMsg.textContent='Error: '+(j.error||r.status); } } catch { learnMsg.textContent='Network error'; } finally { learnBtn.disabled=false; learnBtn.textContent='Queue Selected'; setTimeout(()=>{ if(learnMsg.textContent.startsWith('Queued')) learnMsg.textContent=''; },4000); } }); }
})();
</script>
</body></html>`);
      return;
    }
    if (path === '/api/unknown-candidates') {
      try {
        const list = aggregateCandidates(50);
        this.writeJson(res, list);
      } catch (e:any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'aggregation_failed', message: e?.message }));
      }
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
      try {
        const queued = queueCandidates([norm], 'dashboard');
        console.error('[LEARN] Queued normalized candidate via dashboard:', norm, queued);
        this.writeJson(res, { ok: true, normalized: norm, queued: true, added: queued.added, skipped: queued.skipped, total: queued.total });
      } catch (e:any) {
        console.error('[LEARN] Queue failed for', norm, e?.message || e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'queue_failed', message: e?.message || String(e) }));
      }
      return;
    }
    if (path === '/api/learn-queue') { try { this.writeJson(res, { queued: listQueuedCandidates() }); } catch(e:any){ res.writeHead(500,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({ error:'queue_list_failed', message:e?.message })); } return; }
    if (path === '/api/learn-queue/approve' && req.method==='POST') { let body=''; req.on('data',d=> body+=d); req.on('end', ()=>{ try { const j=JSON.parse(body||'{}'); if(!Array.isArray(j.normalized)){ res.writeHead(400,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'normalized_required'})); return;} const r=approveQueuedCandidates(j.normalized,'dashboard'); this.writeJson(res,r); } catch(e:any){ res.writeHead(500,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'approve_failed', message:e?.message })); } }); return; }
    if (path === '/api/learn-queue/remove' && req.method==='POST') { let body=''; req.on('data',d=> body+=d); req.on('end', ()=>{ try { const j=JSON.parse(body||'{}'); if(!Array.isArray(j.normalized)){ res.writeHead(400,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'normalized_required'})); return;} const r=removeFromQueue(j.normalized); this.writeJson(res,r); } catch(e:any){ res.writeHead(500,{ 'Content-Type':'application/json'}); res.end(JSON.stringify({error:'remove_failed', message:e?.message })); } }); return; }
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
      this.emitter.emit('exec', {
        id: 'heartbeat',
        level: 'HEARTBEAT',
        durationMs: 0,
        blocked: false,
        truncated: false,
        timestamp: new Date().toISOString()
      });
    }, this.heartbeatIntervalMs).unref();
  }

  private parseQuery(url: string): Record<string,string> {
    const idx = url.indexOf('?');
    if (idx === -1) return {};
    const q = url.substring(idx+1);
    return Object.fromEntries(q.split('&').map(kv=>{const [k,v='']=kv.split('=');return [decodeURIComponent(k), decodeURIComponent(v)];}));
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

        // Update historical data for graphs
        const now = Date.now();
  this.cpuHistory.push({ timestamp: now, value: +cpuPercent.toFixed(2), lag: +lagP95.toFixed(2) });
        this.memHistory.push({ timestamp: now, rss: +rssMB.toFixed(1), heap: +heapUsedMB.toFixed(1) });

        // Keep only recent history (last 60 samples = 2 minutes at 2s intervals)
        if (this.cpuHistory.length > this.historyLimit) {
          this.cpuHistory.shift();
        }
        if (this.memHistory.length > this.historyLimit) {
          this.memHistory.shift();
        }
      } catch {}
    }, this.perfSampleIntervalMs).unref();
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
}

const port = process.env.METRICS_PORT ? parseInt(process.env.METRICS_PORT,10) : 9090;
const scanMaxOffset = process.env.METRICS_PORT_SCAN_MAX ? parseInt(process.env.METRICS_PORT_SCAN_MAX,10) : 10;
export const metricsHttpServer = new MetricsHttpServer({ port, enabled: true, scanMaxOffset, autoDisableOnFailure: true });
