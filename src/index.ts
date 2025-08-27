/**
 * PowerShell MCP Server - Main Entry Point
 * 
 * This is the primary entry point for the Enterprise PowerShell MCP Server.
 * The server provides secure PowerShell command execution with comprehensive
 * audit logging, security classification, and enterprise-grade features.
 */

// START_MODE=health early exit (fast health probe avoids full startup hang)
if (process.env.START_MODE === 'health') {
    const start = Date.now();
    try {
        const health = {
            mode: 'health',
            status: 'ok',
            timestamp: new Date().toISOString(),
            pid: process.pid,
            node: process.version,
            platform: process.platform,
            cwd: process.cwd(),
            memoryMB: Math.round(process.memoryUsage().rss/1024/1024),
            uptimeSec: process.uptime(),
            versions: { typescript: undefined }
        };
        // Try to read package.json to include version info without requiring build
        try {
            const pkg = await import(new URL('../package.json', import.meta.url).href, { assert: { type: 'json' } } as any);
            (health as any).package = { name: pkg.default.name, version: pkg.default.version };
        } catch {}
        console.log(JSON.stringify(health));
        process.exit(0);
    } catch (e) {
        console.error(JSON.stringify({ mode: 'health', status: 'error', error: (e as Error).message }));
        process.exit(1);
    }
}

// Export the main server implementation (enterprise server currently at server.ts)
export * from './server.js';

// Dynamic import to start server when executed directly (skipped in health mode)
import('./server.js').catch(error => {
    console.error('Failed to start PowerShell MCP Server:', error);
    process.exit(1);
});
