import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

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
  analyzerIssues?: any[];
  analyzerAvailable?: boolean;
  cacheHit?: boolean;
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
// Basic LRU cache
const CACHE_LIMIT = 100;
const syntaxCache = new Map<string, PwshSyntaxResult>();

export async function parsePowerShellSyntax(script: string, opts?: { timeoutMs?: number }): Promise<PwshSyntaxResult> {
  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 5000;
  if (!script.trim()) return { ok: true, issues: [], parser: 'fallback', durationMs: 0, scriptLength: 0 };
  const hash = createHash('sha256').update(script).digest('hex');
  if (syntaxCache.has(hash)) {
    const cached = syntaxCache.get(hash)!;
    return { ...cached, durationMs: Date.now() - start, cacheHit: true };
  }
  if (process.env.PWSH_SYNTAX_FORCE_FALLBACK === '1') {
    const fb = fallbackCheck(script, start); syntaxCache.set(hash, fb); trimCache(); return fb;
  }
  const shellExe = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';
  let tmpScriptPath: string | undefined;
  try {
    tmpScriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pwsh-syntax-')), 'input.ps1');
    fs.writeFileSync(tmpScriptPath, script, 'utf8');
  } catch {
    const fb = fallbackCheck(script, start); syntaxCache.set(hash, fb); trimCache(); return fb;
  }
  const driver = `[System.Management.Automation.Language.Parser]::ParseInput((Get-Content -Raw '${tmpScriptPath.replace(/'/g,"''")}'),[ref]$null,[ref]([System.Collections.ObjectModel.Collection[System.Management.Automation.Language.ParseError]]$errs)) | Out-Null; if($errs.Count -eq 0){ '{"ok":true,"issues":[]}' } else { $data = $errs | ForEach-Object { [PSCustomObject]@{ message=$_.Message; startLine=$_.Extent.StartLineNumber; startColumn=$_.Extent.StartColumnNumber; endLine=$_.Extent.EndLineNumber; endColumn=$_.Extent.EndColumnNumber; text=$_.Extent.Text } }; '{"ok":false,"issues":'+ ($data | ConvertTo-Json -Depth 4 -Compress) + '}' }`;
  return await new Promise<PwshSyntaxResult>((resolve) => {
    let settled = false; let stdout=''; let stderr='';
    const child = spawn(shellExe, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', driver], { windowsHide:true });
    child.stdout.on('data', d=> stdout += d.toString());
    child.stderr.on('data', d=> stderr += d.toString());
    const finish = (forceFallback?: boolean) => {
      if(settled) return; settled=true; try { if(tmpScriptPath && fs.existsSync(tmpScriptPath)){ try{ fs.unlinkSync(tmpScriptPath); }catch{} try { fs.rmSync(path.dirname(tmpScriptPath), { recursive:true, force:true }); } catch{} } } catch{}
      if(forceFallback){ const fb = fallbackCheck(script, start); syntaxCache.set(hash, fb); trimCache(); return resolve(fb); }
      try {
        const jsonLine = stdout.trim().split(/\r?\n/).filter(l=> l.startsWith('{') && l.endsWith('}')).pop() || stdout.trim();
        const parsed = JSON.parse(jsonLine);
        const base: PwshSyntaxResult = { ok: parsed.ok, issues: parsed.issues||[], parser:'powershell', durationMs: Date.now()-start, scriptLength: script.length };
        if(process.env.PWSH_SYNTAX_ANALYZER==='1' && base.ok){
          runAnalyzer(script).then(an=>{ const merged = { ...base, analyzerIssues: an.issues, analyzerAvailable: an.available }; syntaxCache.set(hash, merged); trimCache(); resolve(merged); }).catch(()=>{ syntaxCache.set(hash, base); trimCache(); resolve(base); });
        } else { syntaxCache.set(hash, base); trimCache(); resolve(base); }
      } catch { const fb = fallbackCheck(script, start); syntaxCache.set(hash, fb); trimCache(); resolve(fb); }
    };
    const t = setTimeout(()=>{ try{ child.kill(); }catch{} finish(true); }, timeoutMs);
    child.on('error', ()=> finish(true));
    child.on('close', ()=>{ clearTimeout(t); finish(); });
  });
}

function trimCache(){ if(syntaxCache.size <= CACHE_LIMIT) return; const keys = Array.from(syntaxCache.keys()); for(let i=0;i< keys.length-CACHE_LIMIT;i++){ syntaxCache.delete(keys[i]); } }

async function runAnalyzer(script: string): Promise<{ issues:any[]; available:boolean }>{
  return await new Promise(resolve=>{
    const shellExe = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';
    const analyzerDriver = `if(-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)){ '{"available":false,"issues":[]}' } else { $temp=[IO.Path]::GetTempFileName()+'.ps1'; Set-Content -Path $temp -Value @'\n${script.replace(/'/g,"''")}\n'@ -Encoding UTF8; $res = Invoke-ScriptAnalyzer -Path $temp -ErrorAction SilentlyContinue; Remove-Item $temp -ErrorAction SilentlyContinue; '{"available":true,"issues":'+ ($res | Select-Object RuleName,Severity,Line,Column,Message | ConvertTo-Json -Compress) + '}' }`;
    let out=''; let err=''; const child = spawn(shellExe, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', analyzerDriver], { windowsHide:true });
    const timeout = setTimeout(()=>{ try{ child.kill(); }catch{} }, 4000);
    child.stdout.on('data', d=> out += d.toString());
    child.stderr.on('data', d=> err += d.toString());
    child.on('close', ()=>{ clearTimeout(timeout); try { const line = out.trim().split(/\r?\n/).filter(l=> l.startsWith('{')).pop() || out.trim(); const parsed = JSON.parse(line); resolve({ issues: parsed.issues||[], available: !!parsed.available }); } catch { resolve({ issues:[], available:false }); } });
    child.on('error', ()=> resolve({ issues:[], available:false }) );
  });
}
