#Requires -Version 5.1

<#
.SYNOPSIS
    Launch the Enterprise MCP Log Monitor in a new window
.DESCRIPTION
    This script opens the LogMonitor.ps1 in a separate PowerShell window
    so you can continue working while monitoring logs in real-time.
#>

param(
    [switch]$Maximized,
    [switch]$NoExit
)

# Check if PrettyLogMonitor.ps1 exists
if (-not (Test-Path "PrettyLogMonitor.ps1")) {
    Write-Host "❌ PrettyLogMonitor.ps1 not found in current directory" -ForegroundColor Red
    Write-Host "📍 Current directory: $(Get-Location)" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "🚀 Starting Beautiful Enterprise MCP Log Monitor..." -ForegroundColor Green
Write-Host "📂 Monitor script: $(Resolve-Path 'PrettyLogMonitor.ps1')" -ForegroundColor Cyan
Write-Host "🔍 Opening in new window..." -ForegroundColor Yellow

try {
    $arguments = @(
        "-ExecutionPolicy", "Bypass"
        "-File", "$(Resolve-Path 'PrettyLogMonitor.ps1')"
    )
    
    if ($NoExit) {
        $arguments += "-NoExit"
    }
    
    $processParams = @{
        FilePath = "pwsh.exe"
        ArgumentList = $arguments
        WorkingDirectory = $PWD.Path
    }
    
    if ($Maximized) {
        $processParams.WindowStyle = "Maximized"
    }
    
    $process = Start-Process @processParams -PassThru
    
    Write-Host "✅ Beautiful Log Monitor started in new window" -ForegroundColor Green
    Write-Host "🆔 Process ID: $($process.Id)" -ForegroundColor Cyan
    Write-Host "🎯 Window Title: Look for 'Enterprise MCP Log Monitor'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "💡 Tips:" -ForegroundColor White
    Write-Host "   • Use Ctrl+C in the monitor window to stop" -ForegroundColor DarkGray
    Write-Host "   • Close this window - monitor runs independently" -ForegroundColor DarkGray
    Write-Host "   • Run with -Maximized for full screen beauty" -ForegroundColor DarkGray
    Write-Host ""
    
} catch {
    Write-Host "❌ Failed to start monitor: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   • Try running as Administrator" -ForegroundColor DarkGray
    Write-Host "   • Check PowerShell execution policy" -ForegroundColor DarkGray
    Write-Host "   • Verify PrettyLogMonitor.ps1 exists" -ForegroundColor DarkGray
    Read-Host "Press Enter to exit"
}
