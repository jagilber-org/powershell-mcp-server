#Requires -Version 5.1

<#
.SYNOPSIS
    Launch Simple Working MCP Log Monitor
#>

param(
    [switch]$Maximized,
    [string]$LogPath
)

Write-Host "🔍 Starting Simple Working MCP Log Monitor..." -ForegroundColor Green
Write-Host "✨ This version ACTUALLY shows logs!" -ForegroundColor Yellow

if ($LogPath) {
    Write-Host "📌 Specific log file: $LogPath" -ForegroundColor Cyan
} else {
    Write-Host "🎯 Auto-detecting latest log in current workspace" -ForegroundColor Cyan
}

Write-Host "🚀 Opening in new window..." -ForegroundColor Green

try {
    $arguments = @(
        "-ExecutionPolicy", "Bypass"
        "-File", "$(Resolve-Path 'SimpleLogMonitor.ps1')"
    )
    
    if ($LogPath) {
        $arguments += "-LogPath", $LogPath
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
    
    Write-Host ""
    Write-Host "✅ Simple Monitor launched successfully!" -ForegroundColor Green
    Write-Host "🆔 Process ID: $($process.Id)" -ForegroundColor Cyan
    Write-Host "🎯 Window Title: Look for 'Simple Working MCP Log Monitor'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "🌟 Features:" -ForegroundColor White
    Write-Host "   • Shows recent log entries immediately" -ForegroundColor DarkGray
    Write-Host "   • Beautiful JSON formatting with colors" -ForegroundColor DarkGray
    Write-Host "   • Real-time monitoring that actually works" -ForegroundColor DarkGray
    Write-Host "   • Simple and reliable - no complex polling" -ForegroundColor DarkGray
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "❌ Failed to start simple monitor: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
}
