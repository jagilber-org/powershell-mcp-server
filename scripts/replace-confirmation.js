#!/usr/bin/env node
/* Bulk terminology normalization: remove 'confirmation'/'confirm' variants leaving only 'confirmed' and 'requires confirmed:true'. */
const fs = require('fs');
const path = require('path');
const exts = new Set(['.ts','.md','.json','.ps1','.mjs']);
const root = process.cwd();
const skipDirs = ['node_modules','dist','.git'];
let changed = 0, scanned = 0;
function shouldSkip(p){ return skipDirs.some(d=> p.split(path.sep).includes(d)); }
function processFile(fp){
  scanned++;
  const orig = fs.readFileSync(fp,'utf8');
  let txt = orig;
  // Preserve existing 'confirmed'
  txt = txt.replace(/\bconfirmed\b/g,'__PRESERVE_CONFIRMED__');
  // Targeted phrase replacements first
  txt = txt.replace(/CONFIRMATION_REQUIRED/g,'CONFIRMED_REQUIRED');
  txt = txt.replace(/\bconfirmation_required\b/gi,'confirmed_required');
  txt = txt.replace(/requires confirmation/gi,'requires confirmed:true');
  txt = txt.replace(/require confirmation/gi,'require confirmed:true');
  txt = txt.replace(/confirmation workflow/gi,'confirmed gating');
  // Remaining standalone tokens
  txt = txt.replace(/\bconfirmation\b/gi,'confirmed');
  // Avoid touching placeholders; replace verb 'confirm' (not already part of placeholder)
  txt = txt.replace(/\bconfirm\b/gi,'confirmed');
  // Restore preserved confirmed tokens
  txt = txt.replace(/__PRESERVE_CONFIRMED__/g,'confirmed');
  if(txt !== orig){
    fs.writeFileSync(fp, txt, 'utf8');
    changed++;
    console.log('Updated', path.relative(root, fp));
  }
}
function walk(dir){
  for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
    const full = path.join(dir, entry.name);
    if(entry.isDirectory()){
      if(shouldSkip(full)) continue;
      walk(full);
    } else if(exts.has(path.extname(entry.name))){
      processFile(full);
    }
  }
}
walk(root);
console.log(`Scan complete. Scanned ${scanned} files, changed ${changed}.`);
