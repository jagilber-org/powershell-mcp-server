// Regression test for OS_BLOCKED format regex: ensure '-Format' parameter not flagged
describe('format regex negative lookbehind', ()=>{
  const rx = /(?<!-)\bformat(\.exe)?\b/i;
  test('matches bare format command', ()=>{
    expect('format').toMatch(rx);
    expect('FORMAT').toMatch(rx);
  });
  test('does not match -Format parameter usage', ()=>{
    expect('-Format o').not.toMatch(rx);
    expect('Get-Date -Format o').not.toMatch(rx);
    expect('something -format json').not.toMatch(rx);
  });
});

