// Synchronous PowerShell host detection with deterministic precedence
// Order of selection:
// 1. ENTERPRISE_CONFIG.shellOverride or env PWSH_EXE if provided
// 2. Explicit well-known installation paths (Windows + *nix)
// 3. First match of 'pwsh' on PATH
// 4. Fallback to 'powershell.exe' (Windows) or 'pwsh' then 'powershell' on *nix
// Exports detectShell(): { exe: string; source: string; edition?: string }

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ENTERPRISE_CONFIG } from '../core/config.js';

interface ShellDetectionResult { exe: string; source: string; edition?: string; tried: string[]; }

function exists(p: string){ try { return fs.existsSync(p); } catch { return false; } }

function whichAll(cmd: string): string[] {
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT||'').split(';').filter(Boolean) : [''];
  const dirs = (process.env.PATH||'').split(sep).filter(Boolean);
  const results: string[] = [];
  for(const d of dirs){
    for(const ext of exts){
      const candidate = path.join(d, cmd + ext);
      if(exists(candidate)) results.push(candidate);
    }
  }
  return Array.from(new Set(results));
}

function getWellKnownCandidates(): string[] {
  const candidates: string[] = [];
  if(process.platform === 'win32'){
    const programFiles = process.env['ProgramFiles'] || 'C:/Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    candidates.push(
      path.join(programFiles, 'PowerShell/7/pwsh.exe'),
      path.join(programFilesX86, 'PowerShell/7/pwsh.exe'),
      'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
    );
  } else {
    candidates.push('/usr/bin/pwsh','/usr/local/bin/pwsh','/snap/bin/pwsh','/opt/microsoft/powershell/7/pwsh');
  }
  return candidates.filter(exists);
}

export function detectShell(): ShellDetectionResult {
  const tried: string[] = [];
  // 1. Config override
  const cfgOverride = (ENTERPRISE_CONFIG as any).shellOverride;
  if(cfgOverride && typeof cfgOverride === 'string'){
    tried.push(cfgOverride + ' (configOverride)');
    if(exists(cfgOverride)) return { exe: cfgOverride, source: 'configOverride', tried };
  }
  // env override
  const envOverride = process.env.PWSH_EXE;
  if(envOverride){
    tried.push(envOverride + ' (env:PWSH_EXE)');
    if(exists(envOverride)) return { exe: envOverride, source: 'env:PWSH_EXE', tried };
  }
  // 2. Well-known locations
  const wellKnown = getWellKnownCandidates();
  for(const wk of wellKnown){ tried.push(wk + ' (wellKnown)'); if(exists(wk)) return { exe: wk, source: 'wellKnown', tried }; }
  // 3. PATH search for pwsh then powershell
  const pwshPaths = whichAll(process.platform === 'win32' ? 'pwsh.exe':'pwsh');
  for(const p of pwshPaths){ tried.push(p + ' (path)'); if(exists(p)) return { exe: p, source: 'path', tried }; }
  const legacy = whichAll(process.platform === 'win32' ? 'powershell.exe':'powershell');
  for(const p of legacy){ tried.push(p + ' (path)'); if(exists(p)) return { exe: p, source: 'path-legacy', tried }; }
  // 4. Fallback
  if(process.platform === 'win32'){ tried.push('powershell.exe (fallback)'); return { exe: 'powershell.exe', source: 'fallback', tried }; }
  tried.push('pwsh (fallback)'); return { exe: 'pwsh', source: 'fallback', tried };
}
