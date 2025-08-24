#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = process.cwd();
const instrDir = path.join(root,'mcp-index-template','instructions');
const docsDir = path.join(root,'mcp-index-template','docs');
const catalogPath = path.join(instrDir,'catalog.json');
const gatesPath = path.join(instrDir,'gates.json');

function sha(str){ return crypto.createHash('sha256').update(str,'utf8').digest('hex'); }

const catalog = JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const gates = JSON.parse(fs.readFileSync(gatesPath,'utf8'));

// Compute checksums per entry if missing
catalog.entries.forEach(e=>{ if(!e.checksum){ e.checksum = sha(e.text); } });
const overallHash = sha(JSON.stringify(catalog.entries.map(e=>e.id+':'+e.checksum).sort()));

// Group by criticality
function section(crit){
  const list = catalog.entries.filter(e=>e.criticality===crit).sort((a,b)=> b.priority - a.priority);
  if(!list.length) return `\n### ${crit}\n( none )`;
  return `\n### ${crit}\n|ID|Priority|Scope|Target|Text|\n|--|--|--|--|--|\n` + list.map(e=>`|${e.id}|${e.priority}|${e.scope}|${e.target}|${e.text.replace(/\|/g,'\\|')}|`).join('\n');
}

const gateTable = (()=>{
  return '\n### Gates\n|Gate|Logic|Action|Inputs|\n|----|-----|------|-------|\n' + gates.gates.map(g=>`|${g.id}|${g.logic.replace(/\|/g,'\\|')}|${g.failureAction}|${g.inputs.join(',')}|`).join('\n');
})();

const out = `<!-- GENERATED: DO NOT EDIT -->\n# Instruction Catalog v${catalog.version}\nOverall Hash: ${overallHash}\n${section('blocking')}${section('strong')}${section('advisory')}${gateTable}\n`;

fs.writeFileSync(path.join(docsDir,'INSTRUCTIONS.md'), out, 'utf8');
fs.writeFileSync(catalogPath, JSON.stringify(catalog,null,2));
console.log('Generated INSTRUCTIONS.md with hash', overallHash);
