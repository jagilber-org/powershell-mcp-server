import { z } from 'zod';

// Core schemas
export const emitLogSchema = z.object({ message: z.string().optional() });
export const runPowerShellSchema = z.object({
  command: z.string().optional(),
  script: z.string().optional(),
  working_directory: z.string().optional(),
  // Allow zero; runtime will substitute default and warn
  timeout_seconds: z.number().min(0).optional(),
  confirmed: z.boolean().optional(),
  // Adaptive timeout parameters (retained)
  progress_adaptive: z.boolean().optional(),
  adaptive_timeout: z.boolean().optional(),
  adaptive_extend_window_ms: z.number().optional(),
  adaptive_extend_step_ms: z.number().optional(),
  adaptive_max_total_sec: z.number().optional(),
});
export const runPowerShellScriptSchema = z.object({
  script: z.string().optional(),
  script_file: z.string().optional(),
  working_directory: z.string().optional(),
  timeout_seconds: z.number().min(0).optional(),
  confirmed: z.boolean().optional()
});
export const syntaxCheckSchema = z.object({ script: z.string().optional(), file_path: z.string().optional() });
export const wdPolicySchema = z.object({ action: z.enum(['get','set']).optional(), enabled: z.boolean().optional(), allowed_write_roots: z.array(z.string()).optional() });
export const serverStatsSchema = z.object({ verbose: z.boolean().optional() });
export const memoryStatsSchema = z.object({ gc: z.boolean().optional() });
export const agentPromptsSchema = z.object({ category: z.string().optional(), format: z.enum(['markdown','json']).optional() });
export const threatAnalysisSchema = z.object({});
export const learnSchema = z.object({
  action: z.enum(['list','recommend','queue','approve','remove']),
  limit: z.number().optional(),
  minCount: z.number().optional(),
  normalized: z.array(z.string()).optional()
});
export const aiAgentTestsSchema = z.object({ test_suite: z.string().optional(), skip_dangerous: z.boolean().optional() });
export const helpSchema = z.object({ topic: z.string().optional() });
export const healthSchema = z.object({});
export const toolTreeSchema = z.object({});

export interface ToolDef { name:string; description:string; zod: z.ZodTypeAny; core?: boolean; stable?: boolean; mutation?: boolean; outputSchema?: Record<string, any>; }

export const toolRegistry: ToolDef[] = [
  { name:'emit_log', description:'Emit structured audit log entry', zod: emitLogSchema, core:true, stable:true, mutation:false, outputSchema:{ type:'object', properties:{ ok:{ type:'boolean' }, truncated:{ type:'boolean' } } } },
  { name:'run_powershell', description:'Execute PowerShell command or script', zod: runPowerShellSchema, core:true, stable:true, mutation:true, outputSchema:{ type:'object', properties:{ success:{ type:'boolean' }, exitCode:{ type:['number','null'] }, stdout:{ type:'string' }, stderr:{ type:'string' }, timedOut:{ type:'boolean' }, terminationReason:{ type:'string' } } } },
  { name:'run_powershellscript', description:'Execute PowerShell via inline script or file', zod: runPowerShellScriptSchema, stable:true, mutation:true },
  { name:'powershell_syntax_check', description:'Validate PowerShell syntax', zod: syntaxCheckSchema, core:true, stable:true, mutation:false, outputSchema:{ type:'object', properties:{ ok:{ type:'boolean' }, issues:{ type:'array' } } } },
  { name:'working_directory_policy', description:'Get or set working directory policy', zod: wdPolicySchema, core:true, stable:true, mutation:true },
  { name:'server_stats', description:'Server metrics snapshot', zod: serverStatsSchema, core:true, stable:true, mutation:false },
  // Deterministic PowerShell process metrics sampling (facilitates non-flaky tests)
  { name:'capture_ps_sample', description:'Force capture of a PowerShell process metrics sample', zod: threatAnalysisSchema, stable:true, mutation:false },
  { name:'memory_stats', description:'Process memory usage (optionally trigger GC)', zod: memoryStatsSchema, stable:true, mutation:false },
  { name:'agent_prompts', description:'Retrieve prompt library content', zod: agentPromptsSchema, stable:true, mutation:false },
  { name:'threat_analysis', description:'Threat / unknown command analysis', zod: threatAnalysisSchema, stable:true, mutation:false },
  { name:'learn', description:'Learning actions (list|recommend|queue|approve|remove)', zod: learnSchema, stable:true, mutation:true },
  { name:'ai_agent_tests', description:'Run AI agent test suite', zod: aiAgentTestsSchema, stable:false, mutation:false },
  { name:'help', description:'Get structured help', zod: helpSchema, core:true, stable:true, mutation:false },
  { name:'health', description:'Health snapshot', zod: healthSchema, stable:true, mutation:false },
  { name:'tool_tree', description:'List core/admin/internal groups', zod: toolTreeSchema, stable:true, mutation:false }
];

// Build a minimal deterministic JSON schema (no $ref) directly from zod definitions
function buildSimpleSchema(zodSchema: z.ZodTypeAny): any {
  const def = (zodSchema as any)?._def;
  if(!def) return { type:'string' };
  const tn = def.typeName;
  switch(tn){
    case 'ZodObject': {
      const shapeFn = def.shape;
      const shape = typeof shapeFn === 'function' ? shapeFn() : shapeFn;
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for(const key of Object.keys(shape)){
        const child = shape[key];
        const childDef = child?._def;
        const optional = childDef?.typeName === 'ZodOptional';
        const inner = optional ? childDef.innerType : child;
        properties[key] = buildSimpleSchema(inner);
        if(!optional) required.push(key);
      }
      const schema: any = { type:'object', properties, additionalProperties:false };
      if(required.length) schema.required = required;
      return schema;
    }
    case 'ZodString': return { type:'string' };
    case 'ZodNumber': return { type:'number' };
    case 'ZodBoolean': return { type:'boolean' };
    case 'ZodEnum': return { type:'string', enum: def.values };
    case 'ZodArray': return { type:'array', items: buildSimpleSchema(def.type) };
    case 'ZodOptional': return buildSimpleSchema(def.innerType);
    case 'ZodEffects': return buildSimpleSchema(def.schema);
    default: return { type:'string' };
  }
}

export function listToolsForSurface(){
  const core = toolRegistry.filter(t=> t.core).map(t=> {
    let inputSchema: any;
    if(t.name === 'run_powershell'){
      // Explicit deterministic schema (avoid any internal zod shape edge cases producing empty properties in some builds)
      inputSchema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type:'string' },
          script: { type:'string' },
          working_directory: { type:'string' },
          timeout_seconds: { type:'number' },
          confirmed: { type:'boolean' },
          progress_adaptive: { type:'boolean' },
          adaptive_timeout: { type:'boolean' },
          adaptive_extend_window_ms: { type:'number' },
          adaptive_extend_step_ms: { type:'number' },
          adaptive_max_total_sec: { type:'number' }
        }
      };
    } else {
      inputSchema = buildSimpleSchema(t.zod);
    }
    return {
      name: t.name,
      description: t.description,
      stable: !!t.stable,
      mutation: !!t.mutation,
      inputSchema,
      outputSchema: t.outputSchema
    };
  });
  // Transitional alias: surface legacy hyphen name in addition to canonical underscore variant
  try {
    const rp = core.find(t=> t.name==='run_powershell');
    if(rp && !core.find(t=> t.name==='run-powershell')){
      core.push({ ...rp, name:'run-powershell' });
    }
  } catch{}
  return core;
}
export function getToolDef(name:string){ return toolRegistry.find(t=> t.name===name); }
export function listToolTree(){ return {
  core: toolRegistry.filter(t=> t.core).map(t=> t.name),
  admin: toolRegistry.filter(t=> !t.core && ['memory-stats','threat-analysis','learn','health','ai-agent-tests'].includes(t.name)).map(t=> t.name),
  other: toolRegistry.filter(t=> !t.core && !['memory-stats','threat-analysis','learn','health','ai-agent-tests'].includes(t.name)).map(t=> t.name)
}; }
