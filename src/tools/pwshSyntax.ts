import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PwshSyntaxIssue {
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface PwshSyntaxResult {
  ok: boolean;
  issues: PwshSyntaxIssue[];
  parser: 'powershell' | 'fallback';
  durationMs: number;
  scriptLength: number;
}

// Fallback simple delimiter balance check (legacy behavior)
function fallbackCheck(script: string, start: number): PwshSyntaxResult {
  const stack: string[] = [];
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  let balanced = true;
  for (const ch of script) {
    if (pairs[ch]) stack.push(ch); else if (Object.values(pairs).includes(ch)) {
      const last = stack.pop();
      if (!last || pairs[last] !== ch) { balanced = false; break; }
    }
  }
  const ok = balanced && stack.length === 0;
  return { ok, issues: ok ? [] : [{ message: 'Unbalanced delimiters detected', startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, text: '' }], parser: 'fallback', durationMs: Date.now() - start, scriptLength: script.length };
}

export async function parsePowerShellSyntax(script: string, opts?: { timeoutMs?: number }): Promise<PwshSyntaxResult> {
  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 5000;
  if (!script.trim()) return { ok: true, issues: [], parser: 'fallback', durationMs: 0, scriptLength: 0 };
  // If PowerShell not present, fallback immediately
  const shellExe = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';
  // Write script to temp file to avoid complicated escaping
  let tmpScriptPath: string | undefined;
  try {
    tmpScriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pwsh-syntax-')), 'input.ps1');
    fs.writeFileSync(tmpScriptPath, script, 'utf8');
  } catch {
    return fallbackCheck(script, start);
  }
  const driver = `[System.Management.Automation.Language.Parser]::ParseInput((Get-Content -Raw '${tmpScriptPath.replace(/'/g,"''")}'),[ref]$null,[ref]([System.Collections.ObjectModel.Collection[System.Management.Automation.Language.ParseError]]$errs)) | Out-Null; if($errs.Count -eq 0){ '{"ok":true,"issues":[]}' } else { $data = $errs | ForEach-Object { [PSCustomObject]@{ message=$_.Message; startLine=$_.Extent.StartLineNumber; startColumn=$_.Extent.StartColumnNumber; endLine=$_.Extent.EndLineNumber; endColumn=$_.Extent.EndColumnNumber; text=$_.Extent.Text } }; '{"ok":false,"issues":'+ ($data | ConvertTo-Json -Depth 4 -Compress) + '}' }`;
  return await new Promise<PwshSyntaxResult>((resolve) => {
    let settled = false;
    const child = spawn(shellExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', driver], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    const finish = (forceFallback?: boolean) => {
      if (settled) return; settled = true; try { if (tmpScriptPath && fs.existsSync(tmpScriptPath)) { try { fs.unlinkSync(tmpScriptPath); } catch {} try { fs.rmSync(path.dirname(tmpScriptPath), { recursive: true, force: true }); } catch {} } } catch {}
      if (forceFallback) { return resolve(fallbackCheck(script, start)); }
      try {
        const jsonLine = stdout.trim().split(/\r?\n/).filter(l => l.startsWith('{') && l.endsWith('}')).pop() || stdout.trim();
        const parsed = JSON.parse(jsonLine);
        const res: PwshSyntaxResult = { ok: parsed.ok, issues: parsed.issues || [], parser: 'powershell', durationMs: Date.now() - start, scriptLength: script.length };
        resolve(res);
      } catch {
        resolve(fallbackCheck(script, start));
      }
    };
    const t = setTimeout(() => { try { child.kill(); } catch {} finish(true); }, timeoutMs);
    child.on('error', () => finish(true));
    child.on('close', () => { clearTimeout(t); finish(); });
  });
}
