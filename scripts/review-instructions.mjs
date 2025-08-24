#!/usr/bin/env node
// Performs deeper review / lint beyond schema validation.
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const catalog = JSON.parse(fs.readFileSync(path.join(root,'instructions','catalog.json'),'utf8'));

let warnings = [];
let errors = [];

// 1. supersedes references must exist
const idMap = new Map();
catalog.entries.forEach(e=>idMap.set(e.id,e));
for(const e of catalog.entries){
  if(e.supersedes){
    for(const sid of e.supersedes){
      if(!idMap.has(sid)) warnings.push(`Entry ${e.id} supersedes missing id ${sid}`);
    }
  }
}

// 2. deprecated entries should be superseded by at least one active entry
const deprecated = catalog.entries.filter(e=>e.status==='deprecated');
for(const d of deprecated){
  const replacers = catalog.entries.filter(e=>e.supersedes && e.supersedes.includes(d.id) && e.status=='active');
  if(replacers.length===0) warnings.push(`Deprecated entry ${d.id} has no active replacer.`);
}

// 3. Priority uniqueness within criticality (soft rule)
const critGroups = {}; catalog.entries.forEach(e=>{ critGroups[e.criticality] ||= {}; (critGroups[e.criticality][e.priority] ||= []).push(e.id); });
for(const [crit, map] of Object.entries(critGroups)){
  for(const [prio, ids] of Object.entries(map)){
    if(ids.length>1) warnings.push(`Criticality ${crit} has duplicate priority ${prio} for ids: ${ids.join(',')}`);
  }
}

// 4. Text style check: recommend sentence starts capitalized and ends with period.
for(const e of catalog.entries){
  const t = e.text.trim();
  if(t && t[0]===t[0].toLowerCase()) warnings.push(`Text for ${e.id} should start with capital letter.`);
  if(!/[.!?]$/.test(t)) warnings.push(`Text for ${e.id} should end with punctuation.`);
}

// 5. ID naming best practice: use category prefix (already implicitly) - verify
for(const e of catalog.entries){
  if(!e.id.startsWith(e.category.split('/')[0])) warnings.push(`Id ${e.id} should start with category segment ${e.category}.`);
}

const summary = {
  version: catalog.version,
  entries: catalog.entries.length,
  counts: { warnings: warnings.length, errors: errors.length },
  warnings,
  errors
};
console.log('Instruction review summary:', { version: summary.version, entries: summary.entries, counts: summary.counts });
warnings.forEach(w=> console.log('WARN:', w));
errors.forEach(er=> console.error('ERROR:', er));
// Machine-readable channel
console.log('INSTRUCTION_REVIEW_JSON::'+JSON.stringify(summary));

process.exit(errors.length?1:0);
