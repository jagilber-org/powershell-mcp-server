// Core configuration exports split from server.ts during modularization refactor
export const ENTERPRISE_CONFIG: any = {
  logging: { structuredAudit: true, truncateIndicator: '...TRUNCATED...' },
  limits: { defaultTimeoutMs: 90000, maxOutputKB: 512, maxLines: 4000, maxCommandChars: 10000, chunkKB: 64, hardKillOnOverflow: true, internalSelfDestructLeadMs: 300, killVerifyWindowMs: 1500 },
  rateLimit: { enabled: true, burst: 10, maxRequests: 5, intervalMs: 10_000 },
  security: { enforceAuth: false, enforceWorkingDirectory: false, allowedWriteRoots: [process.cwd()], additionalSafe: [], additionalBlocked: [], suppressPatterns: [] }
};
