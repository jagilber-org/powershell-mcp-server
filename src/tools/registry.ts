import { z } from 'zod';

// Core schemas
export const emitLogSchema = z.object({ message: z.string().optional() });
export const runPowerShellSchema = z.object({
  command: z.string().optional(),
  script: z.string().optional(),
  workingDirectory: z.string().optional(),
  // Allow zero; runtime will substitute default and warn
  timeoutSeconds: z.number().min(0).optional(),
  confirmed: z.boolean().optional(),
  // Adaptive timeout parameters (retained)
  progressAdaptive: z.boolean().optional(),
  adaptiveTimeout: z.boolean().optional(),
  adaptiveExtendWindowMs: z.number().optional(),
  adaptiveExtendStepMs: z.number().optional(),
  adaptiveMaxTotalSec: z.number().optional(),
});
export const runPowerShellScriptSchema = z.object({
  script: z.string().optional(),
  scriptFile: z.string().optional(),
  workingDirectory: z.string().optional(),
  timeoutSeconds: z.number().min(0).optional(),
  confirmed: z.boolean().optional()
});
export const syntaxCheckSchema = z.object({ script: z.string().optional(), filePath: z.string().optional() });
export const wdPolicySchema = z.object({ action: z.enum(['get','set']).optional(), enabled: z.boolean().optional(), allowedWriteRoots: z.array(z.string()).optional() });
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
export const aiAgentTestsSchema = z.object({ testSuite: z.string().optional(), skipDangerous: z.boolean().optional() });
export const helpSchema = z.object({ topic: z.string().optional() });
export const healthSchema = z.object({});
export const toolTreeSchema = z.object({});

export interface ToolDef { name:string; description:string; zod: z.ZodTypeAny; core?: boolean; stable?: boolean; mutation?: boolean; outputSchema?: Record<string, any>; }

export const toolRegistry: ToolDef[] = [
  { name:'emit-log', description:'Emit structured audit log entry', zod: emitLogSchema, core:true, stable:true, mutation:false, outputSchema:{ type:'object', properties:{ ok:{ type:'boolean' }, truncated:{ type:'boolean' } } } },
  { name:'run-powershell', description:'Execute PowerShell command or script', zod: runPowerShellSchema, core:true, stable:true, mutation:true, outputSchema:{ type:'object', properties:{ success:{ type:'boolean' }, exitCode:{ type:['number','null'] }, stdout:{ type:'string' }, stderr:{ type:'string' }, timedOut:{ type:'boolean' }, terminationReason:{ type:'string' } } } },
  { name:'run-powershellscript', description:'Execute PowerShell via inline script or file', zod: runPowerShellScriptSchema, stable:true, mutation:true },
  { name:'powershell-syntax-check', description:'Validate PowerShell syntax', zod: syntaxCheckSchema, core:true, stable:true, mutation:false, outputSchema:{ type:'object', properties:{ ok:{ type:'boolean' }, issues:{ type:'array' } } } },
  { name:'working-directory-policy', description:'Get or set working directory policy', zod: wdPolicySchema, core:true, stable:true, mutation:true },
  { name:'server-stats', description:'Server metrics snapshot', zod: serverStatsSchema, core:true, stable:true, mutation:false },
  // Deterministic PowerShell process metrics sampling (facilitates non-flaky tests)
  { name:'capture-ps-sample', description:'Force capture of a PowerShell process metrics sample', zod: threatAnalysisSchema, stable:true, mutation:false },
  { name:'memory-stats', description:'Process memory usage (optionally trigger GC)', zod: memoryStatsSchema, stable:true, mutation:false },
  { name:'agent-prompts', description:'Retrieve prompt library content', zod: agentPromptsSchema, stable:true, mutation:false },
  { name:'threat-analysis', description:'Threat / unknown command analysis', zod: threatAnalysisSchema, stable:true, mutation:false },
  { name:'learn', description:'Learning actions (list|recommend|queue|approve|remove)', zod: learnSchema, stable:true, mutation:true },
  { name:'ai-agent-tests', description:'Run AI agent test suite', zod: aiAgentTestsSchema, stable:false, mutation:false },
  { name:'help', description:'Get structured help', zod: helpSchema, core:true, stable:true, mutation:false },
  { name:'health', description:'Health snapshot', zod: healthSchema, stable:true, mutation:false },
  { name:'tool-tree', description:'List core/admin/internal groups', zod: toolTreeSchema, stable:true, mutation:false }
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
  return toolRegistry.filter(t=> t.core).map(t=> {
    let inputSchema: any;
    if(t.name === 'run-powershell'){
      // Explicit deterministic schema (avoid any internal zod shape edge cases producing empty properties in some builds)
      inputSchema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type:'string' },
          script: { type:'string' },
          workingDirectory: { type:'string' },
          timeoutSeconds: { type:'number' },
          confirmed: { type:'boolean' },
          progressAdaptive: { type:'boolean' },
          adaptiveTimeout: { type:'boolean' },
          adaptiveExtendWindowMs: { type:'number' },
          adaptiveExtendStepMs: { type:'number' },
          adaptiveMaxTotalSec: { type:'number' }
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
}
export function getToolDef(name:string){ return toolRegistry.find(t=> t.name===name); }
export function listToolTree(){ return {
  core: toolRegistry.filter(t=> t.core).map(t=> t.name),
  admin: toolRegistry.filter(t=> !t.core && ['memory-stats','threat-analysis','learn','health','ai-agent-tests'].includes(t.name)).map(t=> t.name),
  other: toolRegistry.filter(t=> !t.core && !['memory-stats','threat-analysis','learn','health','ai-agent-tests'].includes(t.name)).map(t=> t.name)
}; }
