import { detectShell } from '../src/core/shellDetection';

// These tests are heuristic because actual system presence varies.
// They focus on ensuring function returns shape & precedence signals.

describe('shellDetection', () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; jest.resetModules(); });

  test('returns an executable string and source', () => {
    const result = detectShell();
    expect(result).toHaveProperty('exe');
    expect(result).toHaveProperty('source');
    expect(Array.isArray(result.tried)).toBe(true);
    expect(result.exe).toBeTruthy();
  });

  test('env override wins when path exists', () => {
    // create a temporary dummy file to simulate override
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(process.cwd(), 'temp-env-pwsh.exe');
    try { fs.writeFileSync(tmp, ''); } catch {}
    process.env.PWSH_EXE = tmp;
    const result = detectShell();
    expect(result.source).toBe('env:PWSH_EXE');
    expect(result.exe).toBe(tmp);
    try { fs.unlinkSync(tmp); } catch {}
  });

  test('fallback returns fallback source when nothing else found (simulated)', () => {
    // Simulate by forcing PATH empty and clearing overrides
    process.env.PWSH_EXE = '';
    process.env.PATH = ''; // unrealistic but forces fallback
    const result = detectShell();
    expect(result.source).toContain('fallback');
    expect(result.exe).toBeTruthy();
  });
});
