import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ENTERPRISE_CONFIG } from './config.js';

export interface ShellDetectionResult { shellExe: string; isPwsh: boolean; edition?: string; source: string; shellTried: string[]; }
let cached: ShellDetectionResult | null = null;

function probe(exe:string, source: string, tried:string[]): ShellDetectionResult | null {
  try {
    const r = spawnSync(exe, ['-NoLogo','-NoProfile','-Command','$PSVersionTable.PSEdition'], { encoding:'utf8', windowsHide:true });
    if(r.status === 0){
      const edition = (r.stdout||'').trim();
      const isPwsh = /core/i.test(edition) || /pwsh/i.test(path.basename(exe));
      return { shellExe: exe, isPwsh, edition, source, shellTried:[...tried] };
    }
  } catch {}
  return null;
}

export function detectShell(): ShellDetectionResult {
  if(cached) return cached;
  const tried: string[] = [];
  const record=(p:string,tag:string)=>{ const label=p+'('+tag+')'; if(!tried.includes(label)) tried.push(label); };
  const finish=(r:ShellDetectionResult)=> (cached={ ...r, shellTried: tried });
  const cfg=(ENTERPRISE_CONFIG as any)?.powershell?.executable || (ENTERPRISE_CONFIG as any).shellOverride;
  if(cfg && fs.existsSync(cfg)){ record(cfg,'config'); const r=probe(cfg,'config',tried); if(r) return finish(r); }
  const envPwsh=process.env.PWSH_EXE; if(envPwsh && fs.existsSync(envPwsh)){ record(envPwsh,'env'); const r=probe(envPwsh,'env',tried); if(r) return finish(r); }
  if(process.platform==='win32'){
    const roots=[process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean) as string[];
    for(const root of roots){ const ps=path.join(root,'PowerShell'); if(fs.existsSync(ps)){ try { const versions=fs.readdirSync(ps).filter(v=>/^\d/.test(v)).sort((a,b)=> b.localeCompare(a,undefined,{numeric:true})); for(const v of versions){ const exe=path.join(ps,v,'pwsh.exe'); record(exe,'wellKnown'); if(fs.existsSync(exe)){ const r=probe(exe,'wellKnown',tried); if(r) return finish(r); } } } catch{} } }
  }
  const pathDirs=(process.env.PATH||'').split(path.delimiter).filter(Boolean);
  for(const d of pathDirs){ for(const n of ['pwsh.exe','pwsh','powershell.exe','powershell']){ const cand=path.join(d,n); if(fs.existsSync(cand)){ record(cand,'path'); const r=probe(cand,'path',tried); if(r) return finish(r); } } }
  const fallback = process.platform==='win32' ? 'powershell.exe':'pwsh';
  record(fallback,'fallback');
  return finish({ shellExe:fallback, isPwsh:/pwsh/i.test(fallback), source:'fallback', shellTried: tried });
}
