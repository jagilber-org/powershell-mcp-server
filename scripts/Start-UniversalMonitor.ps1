#Requires -Version 5.1

<#
.SYNOPSIS
    Launch Universal Enterprise MCP Log Monitor that can detect MCP servers in ANY workspace
.PARAMETER Maximized
    Start the monitor window maximized
.PARAMETER LogPath
    Specify a specific log file to monitor
#>

param(
    [switch]$Maximized,
    [string]$LogPath
)

Write-Host "🌐 Starting Universal Enterprise MCP Log Monitor..." -ForegroundColor Green
Write-Host "🔍 This monitor can detect MCP servers running in ANY workspace!" -ForegroundColor Cyan

if ($LogPath) {
    Write-Host "📌 Specific log file: $LogPath" -ForegroundColor Yellow
} else {
    Write-Host "🎯 Auto-detection mode: Will find running MCP servers anywhere" -ForegroundColor Yellow
}

Write-Host "🚀 Opening in new window..." -ForegroundColor Green

try {
    $arguments = @(
        "-ExecutionPolicy", "Bypass"
        "-File", "$(Resolve-Path 'UniversalLogMonitor.ps1')"
    )
    
    if ($LogPath) {
        $arguments += "-LogPath", $LogPath
    } else {
        $arguments += "-AutoDetect"
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
    Write-Host "✅ Universal Monitor launched successfully!" -ForegroundColor Green
    Write-Host "🆔 Process ID: $($process.Id)" -ForegroundColor Cyan
    Write-Host "🎯 Window Title: Look for 'Universal Enterprise MCP Log Monitor'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "🌟 Features:" -ForegroundColor White
    Write-Host "   • Auto-detects MCP servers in ANY workspace" -ForegroundColor DarkGray
    Write-Host "   • Multi-workspace log file discovery" -ForegroundColor DarkGray
    Write-Host "   • Beautiful JSON formatting with colors" -ForegroundColor DarkGray
    Write-Host "   • Real-time security intelligence monitoring" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "💡 Usage Tips:" -ForegroundColor White
    Write-Host "   • Monitor will auto-find your running MCP server" -ForegroundColor DarkGray
    Write-Host "   • If multiple servers found, you can choose which to monitor" -ForegroundColor DarkGray
    Write-Host "   • Use Ctrl+C in monitor window to stop" -ForegroundColor DarkGray
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "❌ Failed to start universal monitor: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   • Try running as Administrator" -ForegroundColor DarkGray
    Write-Host "   • Check PowerShell execution policy" -ForegroundColor DarkGray
    Write-Host "   • Verify UniversalLogMonitor.ps1 exists" -ForegroundColor DarkGray
    Read-Host "Press Enter to exit"
}
