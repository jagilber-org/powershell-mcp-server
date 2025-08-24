// Audit logging utilities extracted from monolithic server
import * as fs from 'fs';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface AuditLogEntry { timestamp: string; level: string; category: string; message: string; metadata?: Record<string, any>; }
let mcpServerInstance: Server | null = null;
let clientSupportsLogging = true;
export function setMCPServer(server: Server){ mcpServerInstance = server; }

const LOG_DIR = path.join(process.cwd(), 'logs');
if(!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR,{recursive:true});

function sanitizeMetadata(metadata: Record<string, any> | undefined){
  if(!metadata) return undefined; const s: Record<string, any> = {}; for(const k of Object.keys(metadata)){ const v = metadata[k]; if(typeof v==='string') s[k]= v.length>100? v.substring(0,100)+'...':v; else if(typeof v==='object'&& v!==null) s[k]='[Object]'; else s[k]=v; } return s;
}

export async function auditLog(level:string, category:string, message:string, metadata?:Record<string,any>): Promise<void>{
  const ts = new Date().toISOString();
  const entry: AuditLogEntry = { timestamp: ts, level, category, message, ...(metadata && { metadata: sanitizeMetadata(metadata) }) };
  if(mcpServerInstance && clientSupportsLogging){
    try{ await mcpServerInstance.notification({ method:'notifications/message', params:{ level: level.toLowerCase(), logger:'powershell-mcp-server', data:`[${category}] ${message}${metadata? ' | '+JSON.stringify(sanitizeMetadata(metadata)):''}` }});}catch{ clientSupportsLogging=false; }
  }
  console.error(`[${level}] [${category}] ${ts} - ${message}` + (metadata? ' | '+JSON.stringify(sanitizeMetadata(metadata)):'') );
  try{
    const day = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR,`powershell-mcp-audit-${day}.log`);
    const ndjsonPath = path.join(LOG_DIR,`powershell-mcp-audit-${day}.ndjson`);
    fs.appendFileSync(logFile, `[AUDIT] ${JSON.stringify(entry,null,2)}\n`);
    fs.appendFileSync(ndjsonPath, JSON.stringify({ ...entry, structured:true })+'\n');
  }catch(err){ console.error('log write failed', err instanceof Error? err.message: String(err)); }
}
