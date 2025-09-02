#!/usr/bin/env pwsh
# Build script for PowerShell MCP Server Enterprise

Write-Host "🔨 Building PowerShell MCP Server Enterprise..." -ForegroundColor Green

# Build the enterprise server (our main production server)
Write-Host "📦 Compiling Unified Enterprise Server (server.ts)..." -ForegroundColor Yellow
npm run build:only | Write-Host

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build complete" -ForegroundColor Green
Write-Host "`n📁 Build Artifacts:" -ForegroundColor Cyan
Get-ChildItem dist/server.* | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize

Write-Host "🚀 Unified Enterprise Server ready (dist/server.js)" -ForegroundColor Green
