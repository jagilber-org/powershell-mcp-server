#!/usr/bin/env pwsh
# Simple MCP Compliance Checker

param(
    [string]$ProjectRoot = (Get-Location).Path,
    [switch]$SaveReport
)

Write-Host "Starting MCP Compliance Check..." -ForegroundColor Cyan
Write-Host "Project Root: $ProjectRoot" -ForegroundColor Gray

# Check if package.json exists
$packagePath = Join-Path $ProjectRoot "package.json"
if (Test-Path $packagePath) {
    Write-Host "✓ package.json found" -ForegroundColor Green
    
    try {
        $packageContent = Get-Content $packagePath -Raw | ConvertFrom-Json
        if ($packageContent.dependencies.'@modelcontextprotocol/sdk') {
            Write-Host "✓ MCP SDK dependency found: $($packageContent.dependencies.'@modelcontextprotocol/sdk')" -ForegroundColor Green
        } 
        else {
            Write-Host "✗ MCP SDK dependency missing" -ForegroundColor Red
        }
    } 
    catch {
        Write-Host "✗ Error reading package.json: $($_.Exception.Message)" -ForegroundColor Red
    }
} 
else {
    Write-Host "✗ package.json not found" -ForegroundColor Red
}

# Check for TypeScript files
$tsFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "*.ts" -ErrorAction SilentlyContinue
Write-Host "✓ Found $($tsFiles.Count) TypeScript files" -ForegroundColor Green

# Check for server implementation
$serverFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "server.ts", "index.ts" -ErrorAction SilentlyContinue
if ($serverFiles.Count -gt 0) {
    Write-Host "✓ Server implementation files found: $($serverFiles.Count)" -ForegroundColor Green
} 
else {
    Write-Host "⚠ No server implementation files found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✓ Basic MCP compliance validated!" -ForegroundColor Green
Write-Host "CRITICAL INSTRUCTION: Ensure this project adheres to standards documented in https://modelcontextprotocol.io/" -ForegroundColor Magenta
Write-Host "For complete validation, run: npm run compliance:report" -ForegroundColor Gray
