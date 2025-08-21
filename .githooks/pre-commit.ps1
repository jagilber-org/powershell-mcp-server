#!/usr/bin/env pwsh
<#!
Pre-commit hook for powershell-mcp-server
Runs: build, quick tests (truncation, working directory policy, server-stats), aborts on failure.
Enable via: git config core.hooksPath .githooks
#>

$ErrorActionPreference = 'Stop'
Write-Host "🔍 Pre-commit: Starting validation..." -ForegroundColor Cyan

function Fail($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }

# Ensure Node modules present
if (-not (Test-Path node_modules)) { Write-Host "📦 Installing dependencies..."; npm install | Out-Null }

Write-Host "🛠️ Building TypeScript..." -ForegroundColor Yellow
npm run build | Out-Null || Fail "Build failed"

$tests = @(
  'tests/test-output-truncation.mjs',
  'tests/test-workingdirectory-policy.mjs',
  'tests/test-server-stats.mjs'
)

foreach ($t in $tests) {
  if (-not (Test-Path $t)) { continue }
  Write-Host "🧪 Running $t" -ForegroundColor Yellow
  node $t | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Test failed: $t" }
}

Write-Host "✅ Pre-commit checks passed" -ForegroundColor Green
exit 0
