#!/usr/bin/env node
/**
 * Phase 1 CLI bootstrap.
 * Provides minimal argument parsing; future phases will extend.
 */
import { Command } from 'commander';
import { loadUnifiedConfig } from './config.js';
import './index.js'; // ensure side-effect startup for now (legacy behavior)

const program = new Command();
program
  .name('powershell-mcp-server')
  .description('Enterprise PowerShell MCP Server CLI')
  .option('--no-metrics', 'Disable in-memory metrics collection (Phase 1)')
  .option('-k, --key <key>', 'Authentication key (overrides MCP_AUTH_KEY)')
  .option('-c, --config <path>', 'Path to enterprise-config.json override (future)')
  .option('--metrics-port <port>', 'Metrics HTTP starting port (default 9090)')
  .option('--dump-config', 'Print merged configuration and exit')
  .option('--dry-run', 'Validate configuration without starting server')
  .allowUnknownOption();

program.parse(process.argv);
const opts = program.opts();

const cfg = loadUnifiedConfig();
if (opts.metrics === false) {
  cfg.metrics.enable = false;
}
if (opts.key) {
  process.env.MCP_AUTH_KEY = opts.key;
}
if (opts.metricsPort) {
  process.env.METRICS_PORT = String(opts.metricsPort);
}

if (opts.dumpConfig) {
  console.error('[CONFIG] Merged configuration:\n' + JSON.stringify(cfg, null, 2));
  process.exit(0);
}

if (opts.dryRun) {
  console.error('[DRY-RUN] Configuration valid. Exiting without starting server.');
  process.exit(0);
}

// For Phase 1 we rely on existing auto-start in index/server.
// Later phases will refactor to explicit start invocation to inject cfg.
