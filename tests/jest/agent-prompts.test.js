const { startServer, waitForReady, collect, request } = require('./util');
const fs = require('fs');
const path = require('path');

describe('agent-prompts hardening', () => {
  test('redacts secret fenced blocks and truncates oversize', async () => {
    const tempFile = path.join(process.cwd(),'docs','AGENT-PROMPTS.md');
    const original = fs.existsSync(tempFile) ? fs.readFileSync(tempFile,'utf8') : '# Prompts\n';
    try {
      const hugeSecret = '```secret\nMY SECRET DATA\n```\n' + '# Heading One\nLine\n'.repeat(4000);
      fs.writeFileSync(tempFile, hugeSecret, 'utf8');
      const srv = startServer();
      await waitForReady(srv);
      const responses = collect(srv);
      const res = await request(srv, responses, 'tools/list', {}, 'list', 1500);
      expect(res).toBeTruthy();
      const ap = await request(srv, responses, 'tools/call', { name:'agent-prompts', arguments:{ format:'markdown' }}, 'ap', 2500);
      const text = ap.result?.content?.[0]?.text || '';
      expect(text).toContain('[SECRET BLOCK REDACTED]');
      // truncated marker
      expect(/TRUNCATED/i.test(text)).toBeTruthy();
      srv.kill();
    } finally {
      fs.writeFileSync(tempFile, original, 'utf8');
    }
  },15000);
});

