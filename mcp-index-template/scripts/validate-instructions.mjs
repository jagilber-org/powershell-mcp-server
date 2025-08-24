#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const root = process.cwd();
const instrDir = path.join(root,'mcp-index-template','instructions');
const schema = JSON.parse(fs.readFileSync(path.join(instrDir,'schema.json'),'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(instrDir,'catalog.json'),'utf8'));

const ajv = new Ajv({ allErrors:true, strict:false });
addFormats(ajv);
const validate = ajv.compile(schema);

if(!validate(catalog)){
  console.error('Catalog validation failed');
  console.error(validate.errors);
  process.exit(1);
}

// Extra rules: duplicate id & vague word lint for blocking
const ids = new Set();
const vagueWords = ['maybe','perhaps','just','try'];
for(const e of catalog.entries){
  if(ids.has(e.id)){ console.error('Duplicate id', e.id); process.exit(2); }
  ids.add(e.id);
  if(e.criticality==='blocking'){
    if(vagueWords.some(w=> e.text.toLowerCase().includes(w))){
      console.error('Blocking rule contains vague wording:', e.id); process.exit(3);
    }
  }
}
console.log('Instruction catalog valid. Entries:', catalog.entries.length);
