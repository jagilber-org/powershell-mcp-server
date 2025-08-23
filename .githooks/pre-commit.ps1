#!/usr/bin/env pwsh
<#!
Pre-commit hook for powershell-mcp-server
Runs: PII check, build, quick tests (truncation, working directory policy, server-stats), aborts on failure.
Enable via: git config core.hooksPath .githooks
#>

$ErrorActionPreference = 'Stop'
Write-Host "🔍 Pre-commit: Starting validation..." -ForegroundColor Cyan

function Fail($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }

# PII Pattern Detection
function Test-PII {
    param([string]$Content, [string]$FilePath)
    
    $piiPatterns = @{
        'CaseNumber' = '\b\d{13,15}\b'  # Long case numbers like in the image
        'ResourcePath' = 'BC1-04-master_[0-9A-F-]+[A-Za-z0-9]+'  # Specific resource paths
        'TimestampPattern' = '\b\d{14}\b'  # Timestamp patterns like 20250117120343
        'GUID' = '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b'
        'WindowsPath' = 'C:\\Windows\\Logs\\[A-Z]+\\[a-zA-Z0-9_\-\\.]+\\.csv'  # Windows log paths
        'IPAddress' = '\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b'
        'EmailAddress' = '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        'PhoneNumber' = '\b\d{3}-\d{3}-\d{4}\b|\b\(\d{3}\)\s*\d{3}-\d{4}\b'
    }
    
    $findings = @()
    foreach ($patternName in $piiPatterns.Keys) {
        $pattern = $piiPatterns[$patternName]
        $matches = [regex]::Matches($Content, $pattern)
        foreach ($match in $matches) {
            $lineNumber = ($Content.Substring(0, $match.Index) -split "`n").Count
            $findings += @{
                File = $FilePath
                Line = $lineNumber
                Pattern = $patternName
                Match = $match.Value
            }
        }
    }
    
    return $findings
}

# Check all staged files for PII (INCLUDING .md files)
Write-Host "🔒 Checking for PII patterns..." -ForegroundColor Yellow
$stagedFiles = git diff --cached --name-only --diff-filter=ACM
$piiFound = @()

foreach ($file in $stagedFiles) {
    if (-not (Test-Path $file)) { continue }
    
    # Check ALL file types - NO exclusions for .md files
    $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
    if ($content) {
        $findings = Test-PII -Content $content -FilePath $file
        $piiFound += $findings
    }
}

if ($piiFound.Count -gt 0) {
    Write-Host "🚨 PII PATTERNS DETECTED - COMMIT BLOCKED" -ForegroundColor Red
    foreach ($finding in $piiFound) {
        Write-Host "  📄 $($finding.File):$($finding.Line) - $($finding.Pattern): $($finding.Match)" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "❗ Please remove or obfuscate the PII data before committing." -ForegroundColor Yellow
    Write-Host "❗ NOTE: .md files are NOT excluded from PII checking for security reasons." -ForegroundColor Yellow
    exit 1
}

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
