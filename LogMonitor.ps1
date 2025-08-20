#Requires -Version 5.1

<#
.SYNOPSIS
    Pretty Real-time MCP Server Log Monitor with Enhanced Formatting
#>

# Enhanced formatting function
function Format-LogEntry {
    param($LogLine)
    
    if (-not $LogLine -or $LogLine.Trim() -eq "") { return }
    
    try {
        # Handle pre-formatted log lines with timestamps
        if ($LogLine -match '^\d{2}:\d{2}:\d{2}\.\d{3}\] \[AUDIT\] ') {
            $jsonPart = $LogLine -replace '^\d{2}:\d{2}:\d{2}\.\d{3}\] \[AUDIT\] ', ''
            $logObj = $jsonPart | ConvertFrom-Json -ErrorAction Stop
        } else {
            $logObj = $LogLine | ConvertFrom-Json -ErrorAction Stop
        }
        
        # Format timestamp
        $timestamp = ([DateTime]$logObj.timestamp).ToString("HH:mm:ss.fff")
        
        # Determine colors and icons based on level and category
        $icon = "📝"
        $levelColor = "White"
        $messageColor = "Gray"
        
        switch ($logObj.level) {
            "CRITICAL" { $icon = "🚨"; $levelColor = "Magenta"; $messageColor = "Red" }
            "ERROR"    { $icon = "❌"; $levelColor = "Red"; $messageColor = "Red" }
            "WARNING"  { $icon = "⚠️"; $levelColor = "Yellow"; $messageColor = "Yellow" }
            "INFO"     { $icon = "ℹ️"; $levelColor = "Cyan"; $messageColor = "White" }
            "DEBUG"    { $icon = "🔧"; $levelColor = "DarkGray"; $messageColor = "DarkGray" }
        }
        
        # Special icons for categories
        switch ($logObj.category) {
            "ALIAS_DETECTED"      { $icon = "🔍"; $messageColor = "Cyan" }
            "UNKNOWN_THREAT"      { $icon = "🚨"; $messageColor = "Red" }
            "SUSPICIOUS_PATTERN"  { $icon = "⚠️"; $messageColor = "Magenta" }
            "THREAT_ANALYSIS"     { $icon = "📊"; $messageColor = "Yellow" }
            "TOOL_EXECUTION"      { $icon = "🔧"; $messageColor = "Green" }
            "AUTH_SUCCESS"        { $icon = "✅"; $messageColor = "Green" }
            "AUTH_FAILED"         { $icon = "🚫"; $messageColor = "Red" }
            "AUTH_DISABLED"       { $icon = "🔓"; $messageColor = "Yellow" }
            "SYSTEM_INFO"         { $icon = "🖥️"; $messageColor = "Blue" }
            "SERVER_START"        { $icon = "🚀"; $messageColor = "Green" }
            "SERVER_READY"        { $icon = "✨"; $messageColor = "Green" }
            "SERVER_CONNECT"      { $icon = "🔗"; $messageColor = "Cyan" }
            "MCP_REQUEST"         { $icon = "📨"; $messageColor = "Blue" }
            "MCP_ERROR"           { $icon = "💥"; $messageColor = "Red" }
            "CONFIRMATION_REQUIRED" { $icon = "❓"; $messageColor = "Yellow" }
        }
        
        # Clean up the message
        $cleanMessage = $logObj.message
        if ($cleanMessage.Length -gt 80) {
            $cleanMessage = $cleanMessage.Substring(0, 77) + "..."
        }
        
        # Format the main message line
        Write-Host ""
        Write-Host "$icon " -NoNewline -ForegroundColor $levelColor
        Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
        Write-Host "$($logObj.level.PadRight(7)) " -NoNewline -ForegroundColor $levelColor
        Write-Host "$cleanMessage" -ForegroundColor $messageColor
        
        # Add formatted metadata for important events
        if ($logObj.metadata) {
            # Show key metadata based on category
            switch ($logObj.category) {
                "ALIAS_DETECTED" {
                    if ($logObj.metadata.originalAlias -and $logObj.metadata.resolvedCmdlet) {
                        Write-Host "   🔗 " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.originalAlias)" -NoNewline -ForegroundColor Yellow
                        Write-Host " → " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.resolvedCmdlet)" -ForegroundColor Green
                    }
                    if ($logObj.metadata.riskLevel) {
                        $riskColor = switch ($logObj.metadata.riskLevel) {
                            "LOW" { "Green" }; "MEDIUM" { "Yellow" }; "HIGH" { "Red" }; "CRITICAL" { "Magenta" }
                            default { "White" }
                        }
                        Write-Host "   ⚠️  Risk: " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.riskLevel)" -ForegroundColor $riskColor
                    }
                }
                "UNKNOWN_THREAT" {
                    if ($logObj.metadata.command) {
                        Write-Host "   💻 Command: " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.command)" -ForegroundColor Red
                    }
                    if ($logObj.metadata.threatCount) {
                        Write-Host "   📊 Threat Count: " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.threatCount)" -ForegroundColor Red
                    }
                }
                "MCP_REQUEST" {
                    if ($logObj.metadata.toolName) {
                        Write-Host "   🔧 Tool: " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.toolName)" -ForegroundColor Cyan
                    }
                }
                "SYSTEM_INFO" {
                    if ($logObj.metadata.nodeVersion -and $logObj.metadata.platform) {
                        Write-Host "   💻 " -NoNewline -ForegroundColor DarkGray
                        Write-Host "Node $($logObj.metadata.nodeVersion)" -NoNewline -ForegroundColor Green
                        Write-Host " on " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.platform)" -ForegroundColor Blue
                    }
                    if ($logObj.metadata.totalMemory -and $logObj.metadata.freeMemory) {
                        Write-Host "   💾 Memory: " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.freeMemory)" -NoNewline -ForegroundColor Green
                        Write-Host " / " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.totalMemory)" -ForegroundColor Blue
                    }
                }
                "MCP_ERROR" {
                    if ($logObj.metadata.errorType) {
                        Write-Host "   � Error: " -NoNewline -ForegroundColor DarkGray
                        Write-Host "$($logObj.metadata.errorType)" -ForegroundColor Red
                    }
                }
            }
        }
        
    } catch {
        # Handle non-JSON lines with basic formatting
        $timestamp = Get-Date -Format "HH:mm:ss.fff"
        Write-Host ""
        Write-Host "📝 [$timestamp] " -NoNewline -ForegroundColor DarkGray
        Write-Host "$LogLine" -ForegroundColor Gray
    }
}

# Header with style
Clear-Host
$Host.UI.RawUI.WindowTitle = "🔍 Enterprise MCP Log Monitor - Real-time Security Intelligence"
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                    🔍 Enterprise MCP Log Monitor                     ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Find the latest log file
$logFiles = Get-ChildItem "logs\powershell-mcp-audit-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending

if (-not $logFiles) {
    Write-Host "❌ No log files found in logs directory" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit
}

$latestLog = $logFiles[0]
Write-Host "📁 Monitoring File: " -NoNewline -ForegroundColor Green
Write-Host "$($latestLog.Name)" -ForegroundColor White
Write-Host "📊 File Size: " -NoNewline -ForegroundColor Green  
Write-Host "$([math]::Round($latestLog.Length / 1KB, 2)) KB" -ForegroundColor White
Write-Host "🕒 Last Modified: " -NoNewline -ForegroundColor Green
Write-Host "$($latestLog.LastWriteTime)" -ForegroundColor White
Write-Host ""
Write-Host "🎯 Status: " -NoNewline -ForegroundColor Green
Write-Host "Monitoring real-time events... " -NoNewline -ForegroundColor Yellow
Write-Host "(Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host ""
# Start monitoring with pretty formatting
Write-Host ""
try {
    # Set up Ctrl+C handler for graceful exit
    $null = Register-EngineEvent PowerShell.Exiting -Action {
        Write-Host ""
        Write-Host "✅ Enterprise MCP Log Monitor stopped gracefully" -ForegroundColor Green
        Write-Host "👋 Thanks for monitoring your security intelligence!" -ForegroundColor Cyan
    }
    
    Get-Content $latestLog.FullName -Wait -Tail 10 | ForEach-Object {
        Format-LogEntry $_
    }
} catch [System.OperationCanceledException] {
    Write-Host ""
    Write-Host "⏹️  Monitor stopped by user (Ctrl+C)" -ForegroundColor Yellow
} catch {
    Write-Host ""
    Write-Host "❌ Error monitoring log: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Write-Host ""
    Write-Host "✅ Log monitor session ended" -ForegroundColor Green
    if ($Host.Name -eq "ConsoleHost") {
        Read-Host "Press Enter to close window"
    }
}
