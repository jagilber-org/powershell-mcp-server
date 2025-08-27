#!/usr/bin/env pwsh
# Build script for PowerShell MCP Server Enterprise

Write-Host "🔨 Building PowerShell MCP Server Enterprise..." -ForegroundColor Green

# Build the enterprise server (our main production server)
Write-Host "📦 Compiling Enterprise Server..." -ForegroundColor Yellow
npx tsc src/vscode-server-enterprise.ts --outDir dist --module es2022 --target es2022 --esModuleInterop --skipLibCheck --strict --moduleResolution bundler

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Enterprise Server build completed successfully!" -ForegroundColor Green
    
    # Show build artifacts
    Write-Host "`n📁 Build Artifacts:" -ForegroundColor Cyan
    Get-ChildItem dist/vscode-server-enterprise.* | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
    
    Write-Host "🚀 Enterprise Server is ready for deployment!" -ForegroundColor Green
    Write-Host "   - Main server (deprecated path previously dist/vscode-server-enterprise.js): dist/server.js" -ForegroundColor Gray
    Write-Host "   - Type definitions: dist/vscode-server-enterprise.d.ts" -ForegroundColor Gray
    Write-Host "   - Source map: dist/server.js.map" -ForegroundColor Gray
} else {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}
