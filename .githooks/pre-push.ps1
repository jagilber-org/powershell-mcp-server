#!/usr/bin/env pwsh
<#!
Pre-push hook: runs full build (which includes jest test suite).
Blocks push on any failure. Designed to complement faster pre-commit hook.
Enable hooks with:  git config core.hooksPath .githooks
Skip long tests (if later added) via setting $env:SKIP_LONG=1 and honoring it inside tests.
!#>
$ErrorActionPreference = 'Stop'
Write-Host "🚀 Pre-push: running full build & test suite..." -ForegroundColor Cyan

if (-not (Test-Path node_modules)) { Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow; npm install | Out-Null }

Write-Host "🛠️ Building + Testing (npm run build)" -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Build/tests failed – push aborted" -ForegroundColor Red; exit 1 }

Write-Host "✅ All tests passed. Proceeding with push." -ForegroundColor Green
exit 0
