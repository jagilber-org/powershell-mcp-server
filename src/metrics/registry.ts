/**
 * Metrics Registry - Phase 1
 * Minimal, dependency-free in-memory metrics collection.
 * Future phases will add Prometheus/OpenTelemetry exporters.
 */

// Security level type replicated locally to avoid circular import.
export type SecurityLevel = 'SAFE' | 'RISKY' | 'DANGEROUS' | 'CRITICAL' | 'BLOCKED' | 'UNKNOWN';

export interface ExecutionRecord {
  level: SecurityLevel;
  blocked: boolean;
  durationMs: number;
  truncated: boolean;
  // Optional per-execution PowerShell process metrics when feature flag enabled
  psCpuSec?: number; // CPU seconds consumed by the PowerShell child process
  psWSMB?: number;   // Working set (MB)
}

export interface MetricsSnapshot {
  totalCommands: number;
  safeCommands: number;
  riskyCommands: number;
  dangerousCommands: number;
  criticalCommands: number;
  blockedCommands: number;
  confirmationRequired: number;
  unknownCommands: number;
  truncatedOutputs: number;
  timeouts: number;
  averageDurationMs: number;
  p95DurationMs: number;
  // Aggregated ps metrics (only present when samples captured)
  psSamples?: number;
  psCpuSecAvg?: number;
  psWSMBAvg?: number;
  psCpuSecP95?: number;
  psWSMBP95?: number;
  lastReset: string;
}

export class MetricsRegistry {
  private counts: Record<string, number> = {
    TOTAL: 0,
    SAFE: 0,
    RISKY: 0,
    DANGEROUS: 0,
    CRITICAL: 0,
    BLOCKED: 0,
  CONFIRM: 0,
    UNKNOWN: 0,
  TRUNCATED: 0,
  TIMEOUTS: 0
  };
  private durations: number[] = [];
  private psCpu: number[] = [];
  private psWS: number[] = [];
  private lastReset = new Date().toISOString();
  private history: Array<ExecutionRecord & { ts: string; seq: number }> = [];
  private seq = 0;

  record(rec: ExecutionRecord): void {
    this.counts.TOTAL++;
    this.counts[rec.level] = (this.counts[rec.level] || 0) + 1;
    if (rec.blocked) this.counts.BLOCKED++;
    if (rec.truncated) this.counts.TRUNCATED++;
    if (rec.durationMs >= 0) this.durations.push(rec.durationMs);
    if (typeof rec.psCpuSec === 'number') this.psCpu.push(rec.psCpuSec);
    if (typeof rec.psWSMB === 'number') this.psWS.push(rec.psWSMB);
    // Backward compatibility: some callers may pass nested psProcessMetrics instead of flattened fields
    // (e.g., tests expecting aggregation). Detect and extract.
    const anyRec:any = rec as any;
    if(anyRec.psProcessMetrics){
      const pm=anyRec.psProcessMetrics; if(typeof pm.CpuSec==='number') this.psCpu.push(pm.CpuSec); if(typeof pm.WS==='number') this.psWS.push(pm.WS);
    }
    // Append to history (cap 1000)
    this.history.push({ ...rec, ts: new Date().toISOString(), seq: ++this.seq });
    if (this.history.length > 1000) this.history.shift();
    if (process.env.METRICS_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.error(`[METRICS][RECORD] seq=${this.seq} level=${rec.level} blocked=${rec.blocked} truncated=${rec.truncated} total=${this.counts.TOTAL} psSamples=${this.psCpu.length}`);
    }
  }

  /** Increment timeout counter (kept separate to avoid changing ExecutionRecord contract) */
  incrementTimeout(): void {
    this.counts.TIMEOUTS++;
  }

  reset(): void {
    Object.keys(this.counts).forEach(k => (this.counts[k] = 0));
  this.durations = [];
  this.psCpu = [];
  this.psWS = [];
    this.lastReset = new Date().toISOString();
  this.history = [];
  this.seq = 0;
  }

  snapshot(resetAfter = false): MetricsSnapshot {
    const avg = this.durations.length
      ? Math.round(this.durations.reduce((a, b) => a + b, 0) / this.durations.length)
      : 0;
    const p95 = this.computeP(0.95);
    const snap: MetricsSnapshot = {
      totalCommands: this.counts.TOTAL,
      safeCommands: this.counts.SAFE,
      riskyCommands: this.counts.RISKY,
      dangerousCommands: this.counts.DANGEROUS,
      criticalCommands: this.counts.CRITICAL,
      blockedCommands: this.counts.BLOCKED,
  confirmationRequired: this.counts.CONFIRM,
      unknownCommands: this.counts.UNKNOWN,
      truncatedOutputs: this.counts.TRUNCATED,
  timeouts: this.counts.TIMEOUTS,
      averageDurationMs: avg,
      p95DurationMs: p95,
      lastReset: this.lastReset
    };
    if(this.psCpu.length){
      snap.psSamples = this.psCpu.length;
      const cpuSum = this.psCpu.reduce((a,b)=>a+b,0);
      const wsSum = this.psWS.reduce((a,b)=>a+b,0);
      snap.psCpuSecAvg = +(cpuSum / this.psCpu.length).toFixed(4);
      snap.psWSMBAvg = +(wsSum / this.psWS.length).toFixed(2);
      snap.psCpuSecP95 = this.computePFrom(this.psCpu,0.95);
      snap.psWSMBP95 = this.computePFrom(this.psWS,0.95);
    } else {
      // Fallback: derive sample count from history if psProcessMetrics objects present (indicates parser path succeeded but arrays not updated)
      const procSamples = this.history.filter(h=> (h as any).psProcessMetrics || typeof (h as any).psCpuSec === 'number').length;
      if(procSamples){
        snap.psSamples = procSamples;
      }
    }
    if (resetAfter) this.reset();
    return snap;
  }

  private computeP(p: number): number {
    if (!this.durations.length) return 0;
    const sorted = [...this.durations].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  }

  private computePFrom(arr: number[], p:number){
    if(!arr.length) return 0;
    const sorted=[...arr].sort((a,b)=>a-b);
    const idx=Math.min(sorted.length-1, Math.floor(p*sorted.length)-1);
    return sorted[Math.max(0,idx)];
  }

  getHistory(): Array<ExecutionRecord & { ts: string; seq: number }> {
    return [...this.history];
  }
}

// Singleton registry for immediate integration.
export const metricsRegistry = new MetricsRegistry();
