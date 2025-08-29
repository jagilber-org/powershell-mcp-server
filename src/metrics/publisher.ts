// Centralized execution event publisher used by server + tools (early + post execution)
import { metricsHttpServer, ExecutionEventPayload } from './httpServer.js';
import { metricsRegistry } from './registry.js';

interface PublishOptions {
  toolName: string;
  level: string;                 // Security level classification
  blocked: boolean;              // Whether blocked by policy
  truncated?: boolean;           // Output truncated (post-exec)
  durationMs?: number;           // Duration (0 for early attempts)
  success?: boolean;             // Success status (false for early attempts)
  exitCode?: number | null;      // Exit code if known
  confirmed?: boolean;           // Whether caller confirmed a risky/unknown action
  timedOut?: boolean;            // Timeout flag
  preview?: string;              // Short preview of command/tool input
  candidateNorm?: string;        // Normalized UNKNOWN candidate (learning system)
  reason?: string;               // Reason for early publish (e.g. 'blocked','confirmation_required')
  requiresPrompt?: boolean;      // Whether confirmation was required
  incrementConfirmation?: boolean; // Increment confirmation-required metric
}

/**
 * Publish an execution attempt or completion to dashboard + metrics registry.
 * Safe guards all exceptions to avoid impacting main flow.
 */
export function publishExecutionAttempt(opts: PublishOptions){
  if(process.env.MCP_DISABLE_ATTEMPT_PUBLISH === '1') return; // soft gate
  try {
    const ev: ExecutionEventPayload = {
      id: `${opts.reason ? 'attempt' : 'exec'}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      level: opts.level,
      durationMs: typeof opts.durationMs === 'number' ? opts.durationMs : 0,
      blocked: opts.blocked,
      truncated: !!opts.truncated,
      timestamp: new Date().toISOString(),
      preview: opts.preview?.slice(0,120),
      exitCode: typeof opts.exitCode === 'number' || opts.exitCode === null ? opts.exitCode : undefined,
      success: typeof opts.success === 'boolean' ? opts.success : false,
      confirmed: opts.confirmed,
      timedOut: opts.timedOut,
      candidateNorm: opts.candidateNorm,
      toolName: opts.toolName
    };
  metricsHttpServer.publishExecution(ev);
  // Record all events (attempts + executions). Execution vs attempt split handled inside registry.
  metricsRegistry.record({ level: ev.level as any, blocked: ev.blocked, durationMs: ev.durationMs, truncated: ev.truncated });
    if(opts.incrementConfirmation){
      try { (metricsRegistry as any).incrementConfirmation?.(); } catch {}
    }
  } catch {/* swallow */}
}
