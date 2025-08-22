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
  confirmationRequired: number;
  unknownCommands: number;
  truncatedOutputs: number;
  timeouts: number;
  averageDurationMs: number;
  p95DurationMs: number;
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
  private lastReset = new Date().toISOString();

  record(rec: ExecutionRecord): void {
    this.counts.TOTAL++;
    this.counts[rec.level] = (this.counts[rec.level] || 0) + 1;
    if (rec.blocked) this.counts.BLOCKED++;
    if (rec.truncated) this.counts.TRUNCATED++;
    if (rec.durationMs >= 0) this.durations.push(rec.durationMs);
  }

  reset(): void {
    Object.keys(this.counts).forEach(k => (this.counts[k] = 0));
    this.durations = [];
    this.lastReset = new Date().toISOString();
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
    if (resetAfter) this.reset();
    return snap;
  }

  private computeP(p: number): number {
    if (!this.durations.length) return 0;
    const sorted = [...this.durations].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  }
}

// Singleton registry for immediate integration.
export const metricsRegistry = new MetricsRegistry();
