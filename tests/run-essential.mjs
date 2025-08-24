// Run essential test scripts sequentially and summarize results.
import fs from 'fs';
import { spawn } from 'child_process';

const list = JSON.parse(fs.readFileSync('tests/ESSENTIAL-TESTS.json','utf8'));

const results = [];

async function runScript(script){
  return new Promise(resolve=>{
    const start = Date.now();
    const proc = spawn('node',[script],{stdio:['ignore','pipe','pipe']});
    let out='', err='';
    proc.stdout.on('data',d=> out+=d.toString());
    proc.stderr.on('data',d=> err+=d.toString());
    proc.on('exit', code=>{
      results.push({script, code, ms: Date.now()-start, outTail: out.slice(-400), errTail: err.slice(-400)});
      resolve();
    });
    proc.on('error', e=>{
      results.push({script, code:-1, ms: Date.now()-start, error:e.message});
      resolve();
    });
  });
}

for (const s of list){ // eslint-disable-next-line no-await-in-loop
  await runScript(s);
}

const summary = {
  executed: results.length,
  passed: results.filter(r=>r.code===0).length,
  failed: results.filter(r=>r.code!==0).length,
  timestamp: new Date().toISOString(),
  results
};

const outFile = `test-results/ESSENTIAL-${Date.now()}.json`;
fs.writeFileSync(outFile, JSON.stringify(summary,null,2));
console.log('Essential test summary saved:', outFile);
console.log(JSON.stringify(summary,null,2));
process.exit(summary.failed?1:0);
