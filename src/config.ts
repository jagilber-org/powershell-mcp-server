/**
 * Unified configuration loader (Phase 1)
 * Layers: defaults <- JSON file (enterprise-config.json) <- env vars (MCP_*)
 * CLI will be integrated in a later sub-phase.
 */
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export const ConfigSchema = z.object({
  metrics: z.object({
    enable: z.boolean().default(true),
  }).default({ enable: true }),
  security: z.object({
    enforceAuth: z.boolean().optional(),
  }).default({}),
});

export type UnifiedConfig = z.infer<typeof ConfigSchema>;

const DEFAULTS: UnifiedConfig = {
  metrics: { enable: true },
  security: { enforceAuth: false }
};

export function loadUnifiedConfig(): UnifiedConfig {
  const filePath = path.join(process.cwd(), 'enterprise-config.json');
  let fileConfig: any = {};
  if (fs.existsSync(filePath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('[CONFIG] Failed to parse enterprise-config.json:', e);
    }
  }

  // Environment overlays
  const envOverlay: any = {};
  if (process.env.MCP_METRICS_ENABLE) {
    envOverlay.metrics = envOverlay.metrics || {};
    envOverlay.metrics.enable = /^true$/i.test(process.env.MCP_METRICS_ENABLE);
  }
  if (process.env.MCP_ENFORCE_AUTH) {
    envOverlay.security = envOverlay.security || {};
    envOverlay.security.enforceAuth = /^true$/i.test(process.env.MCP_ENFORCE_AUTH);
  }

  const merged = { ...DEFAULTS, ...fileConfig, ...envOverlay };
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    console.error('[CONFIG] Validation errors:', parsed.error.issues.map(i => i.message).join('; '));
    return DEFAULTS;
  }
  return parsed.data;
}
