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
}

export interface MetricsSnapshot {
  totalCommands: number;
  safeCommands: number;
  riskyCommands: number;
  dangerousCommands: number;
  criticalCommands: number;
  blockedCommands: number;
  confirmedRequired: number; // renamed from confirmationRequired (count of pending confirmations)
  unknownCommands: number;
  truncatedOutputs: number;
  timeouts: number;
  averageDurationMs: number;
  p95DurationMs: number;
  lastReset: string;
  // PowerShell process metrics aggregation (when enabled)
  psSamples?: number;
  psCpuSecAvg?: number;
  psWSMBAvg?: number;
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
  // Attempt / execution split (added post feedback feature hardening)
  // ATTEMPT_TOTAL: blocked + confirmation-required attempts (durationMs === 0)
  // ATTEMPT_CONFIRM: subset of attempts that required confirmation (RISKY / UNKNOWN)
  // EXECUTIONS: real executions (durationMs > 0)
  // CONFIRM_EXEC: executions of commands that required confirmation (RISKY / UNKNOWN with confirmed:true)
  private attemptCounters: Record<string, number> = {
    ATTEMPT_TOTAL: 0,
    ATTEMPT_CONFIRM: 0,
    EXECUTIONS: 0,
    CONFIRM_EXEC: 0
  };
  private durations: number[] = [];
  private lastReset = new Date().toISOString();
  private history: Array<ExecutionRecord & { ts: string; seq: number }> = [];
  private seq = 0;
  // Aggregated PowerShell process samples
  private psCpuTotal = 0; // cumulative CPU seconds
  private psWSMBTotal = 0; // cumulative working set MB
  private psSamples = 0;

  record(rec: ExecutionRecord): void {
    this.counts.TOTAL++;
    this.counts[rec.level] = (this.counts[rec.level] || 0) + 1;
    if (rec.blocked) this.counts.BLOCKED++;
    if (rec.truncated) this.counts.TRUNCATED++;
    // Attempt / execution classification
    if(rec.durationMs === 0){
      this.attemptCounters.ATTEMPT_TOTAL++;
      if(rec.level === 'RISKY' || rec.level === 'UNKNOWN') this.attemptCounters.ATTEMPT_CONFIRM++;
    } else if(rec.durationMs > 0){
      this.durations.push(rec.durationMs); // only positive durations influence latency
      this.attemptCounters.EXECUTIONS++;
      if(rec.level === 'RISKY' || rec.level === 'UNKNOWN') this.attemptCounters.CONFIRM_EXEC++;
    }
    // Append to history (cap 1000)
    this.history.push({ ...rec, ts: new Date().toISOString(), seq: ++this.seq });
    if (this.history.length > 1000) this.history.shift();
    if (process.env.METRICS_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.error(`[METRICS][RECORD] seq=${this.seq} level=${rec.level} blocked=${rec.blocked} truncated=${rec.truncated} total=${this.counts.TOTAL}`);
    }
  }


  /** Increment timeout counter (kept separate to avoid changing ExecutionRecord contract) */
  incrementTimeout(): void {
    this.counts.TIMEOUTS++;
  }

  /** Increment confirmed-required (pending user confirmation) counter */
  incrementConfirmedRequired(): void {
    this.counts.CONFIRM++;
  }

  reset(): void {
    Object.keys(this.counts).forEach(k => (this.counts[k] = 0));
    this.durations = [];
    this.lastReset = new Date().toISOString();
  this.history = [];
  this.seq = 0;
  this.psCpuTotal = 0; this.psWSMBTotal = 0; this.psSamples = 0;
  Object.keys(this.attemptCounters).forEach(k => this.attemptCounters[k] = 0);
  }

  snapshot(resetAfter = false): MetricsSnapshot {
    const avg = this.durations.length
      ? Math.round(this.durations.reduce((a, b) => a + b, 0) / this.durations.length)
      : 0;
    const p95 = this.computeP(0.95);
  let p95Adj = p95;
  if(p95Adj < avg) p95Adj = avg; // enforce monotonic p95 >= average
  const snap: MetricsSnapshot = {
      totalCommands: this.counts.TOTAL,
      safeCommands: this.counts.SAFE,
      riskyCommands: this.counts.RISKY,
      dangerousCommands: this.counts.DANGEROUS,
      criticalCommands: this.counts.CRITICAL,
      blockedCommands: this.counts.BLOCKED,
  confirmedRequired: this.counts.CONFIRM,
      unknownCommands: this.counts.UNKNOWN,
      truncatedOutputs: this.counts.TRUNCATED,
  timeouts: this.counts.TIMEOUTS,
      averageDurationMs: avg,
  p95DurationMs: p95Adj,
      lastReset: this.lastReset
    };
    // Attempt / execution counters surfaced when any non-zero
    if(this.attemptCounters.ATTEMPT_TOTAL > 0 || this.attemptCounters.EXECUTIONS > 0){
      (snap as any).attemptCommands = this.attemptCounters.ATTEMPT_TOTAL;
  (snap as any).attemptConfirmedRequired = this.attemptCounters.ATTEMPT_CONFIRM;
      (snap as any).executionCommands = this.attemptCounters.EXECUTIONS;
      (snap as any).confirmedExecutions = this.attemptCounters.CONFIRM_EXEC;
      if(this.attemptCounters.ATTEMPT_CONFIRM > 0){
        const conv = this.attemptCounters.CONFIRM_EXEC / Math.max(1, this.attemptCounters.ATTEMPT_CONFIRM);
  (snap as any).confirmedConversion = +conv.toFixed(3);
      }
    }
    if(this.psSamples>0){
      snap.psSamples = this.psSamples;
      snap.psCpuSecAvg = +(this.psCpuTotal / this.psSamples).toFixed(3);
      snap.psWSMBAvg = +(this.psWSMBTotal / this.psSamples).toFixed(2);
    }
    if (resetAfter) this.reset();
    return snap;
  }

  private computeP(p: number): number {
  if (!this.durations.length) return 0;
  const sorted = [...this.durations].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
  }

  getHistory(): Array<ExecutionRecord & { ts: string; seq: number }> {
    return [...this.history];
  }

  /** Capture a PowerShell process metric sample (CPU seconds, Working Set MB) */
  capturePsSample(cpuSec:number, wsMB:number){
    this.psCpuTotal += cpuSec;
    this.psWSMBTotal += wsMB;
    this.psSamples += 1;
  }
}

// Singleton registry for immediate integration.
export const metricsRegistry = new MetricsRegistry();
