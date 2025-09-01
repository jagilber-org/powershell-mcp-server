#Requires -Version 5.1

<#
.SYNOPSIS
    Beautiful Enterprise MCP Log Monitor with Proper JSON Formatting and Colors
#>

function Show-PrettyLogEntry {
    param($JsonData)
    
    $timestamp = ([DateTime]$JsonData.timestamp).ToString("HH:mm:ss.fff")
    
    # Get icon and colors based on level and category
    $icon = "📝"; $levelColor = "White"; $messageColor = "Gray"
    
    switch ($JsonData.level) {
        "CRITICAL" { $icon = "🚨"; $levelColor = "Magenta"; $messageColor = "Red" }
        "ERROR"    { $icon = "❌"; $levelColor = "Red"; $messageColor = "Red" }
        "WARNING"  { $icon = "⚠️ "; $levelColor = "Yellow"; $messageColor = "Yellow" }
        "INFO"     { $icon = "ℹ️ "; $levelColor = "Cyan"; $messageColor = "White" }
        "DEBUG"    { $icon = "🔧"; $levelColor = "DarkGray"; $messageColor = "DarkGray" }
    }
    
    # Special category icons
    switch ($JsonData.category) {
        "ALIAS_DETECTED"      { $icon = "🔍"; $messageColor = "Cyan" }
        "UNKNOWN_THREAT"      { $icon = "🚨"; $messageColor = "Red" }
        "SUSPICIOUS_PATTERN"  { $icon = "⚠️ "; $messageColor = "Magenta" }
        "THREAT_ANALYSIS"     { $icon = "📊"; $messageColor = "Yellow" }
        "TOOL_EXECUTION"      { $icon = "🔧"; $messageColor = "Green" }
        "AUTH_SUCCESS"        { $icon = "✅"; $messageColor = "Green" }
        "AUTH_FAILED"         { $icon = "🚫"; $messageColor = "Red" }
        "AUTH_DISABLED"       { $icon = "⚠️ "; $messageColor = "Yellow" }
        "SYSTEM_INFO"         { $icon = "🖥️ "; $messageColor = "Blue" }
        "SERVER_START"        { $icon = "🚀"; $messageColor = "Green" }
        "SERVER_READY"        { $icon = "✅"; $messageColor = "Green" }
        "SERVER_CONNECT"      { $icon = "🔗"; $messageColor = "Cyan" }
        "MCP_REQUEST"         { $icon = "📤"; $messageColor = "Blue" }
        "MCP_ERROR"           { $icon = "❌"; $messageColor = "Red" }
        "CONFIRMED_REQUIRED" { $icon = "❓"; $messageColor = "Yellow" }
    }
    
    # Main log line
    Write-Host "$icon " -NoNewline -ForegroundColor $levelColor
    Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
    Write-Host "[$($JsonData.level.PadRight(7))] " -NoNewline -ForegroundColor $levelColor
    Write-Host "$($JsonData.message)" -ForegroundColor $messageColor
    
    # Show important metadata
    if ($JsonData.metadata) {
        $meta = $JsonData.metadata
        
        # Command info
        if ($meta.command -or $meta.fullCommand) {
            $cmd = if ($meta.fullCommand) { $meta.fullCommand } else { $meta.command }
            Write-Host "    💻 Command: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$cmd" -ForegroundColor White
        }
        
        # Alias detection details
        if ($meta.originalAlias -and $meta.resolvedCmdlet) {
            Write-Host "    🔗 Alias: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.originalAlias)" -NoNewline -ForegroundColor Yellow
            Write-Host " → " -NoNewline -ForegroundColor DarkGray  
            Write-Host "$($meta.resolvedCmdlet)" -ForegroundColor Green
        }
        
        # Risk level
        if ($meta.riskLevel) {
            $riskColor = switch ($meta.riskLevel) {
                "LOW" { "Green" }
                "MEDIUM" { "Yellow" }
                "HIGH" { "Red" } 
                "CRITICAL" { "Magenta" }
                default { "White" }
            }
            Write-Host "    ⚠️  Risk Level: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.riskLevel)" -ForegroundColor $riskColor
        }
        
        # Tool/request info
        if ($meta.toolName) {
            Write-Host "    🔧 Tool: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.toolName)" -ForegroundColor Cyan
        }
        
        # Error details
        if ($meta.errorType -or $meta.errorMessage) {
            if ($meta.errorType) {
                Write-Host "    ❌ Error Type: " -NoNewline -ForegroundColor DarkGray
                Write-Host "$($meta.errorType)" -ForegroundColor Red
            }
        }
        
        # System info (abbreviated)
        if ($meta.nodeVersion -and $meta.platform) {
            Write-Host "    🖥️  System: " -NoNewline -ForegroundColor DarkGray
            Write-Host "Node $($meta.nodeVersion) on $($meta.platform)" -ForegroundColor Blue
        }
    }
    
    Write-Host "" # Blank line for readability
}

# Beautiful header
Clear-Host
$Host.UI.RawUI.WindowTitle = "🔍 Enterprise MCP Log Monitor - Real-time Security Intelligence"
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║            🔍 ENTERPRISE MCP LOG MONITOR - PRETTY MODE              ║" -ForegroundColor Cyan  
Write-Host "╚═══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Find log file
$logFiles = Get-ChildItem "logs\powershell-mcp-audit-*.log" -ErrorAction SilentlyContinue | 
    Sort-Object LastWriteTime -Descending

if (-not $logFiles) {
    Write-Host "❌ No audit log files found in logs directory" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$latestLog = $logFiles[0]
Write-Host "📁 Monitoring: " -NoNewline -ForegroundColor Green
Write-Host "$($latestLog.Name)" -ForegroundColor White
Write-Host "📊 Size: " -NoNewline -ForegroundColor Green
Write-Host "$([math]::Round($latestLog.Length / 1KB, 2)) KB" -ForegroundColor White
Write-Host "🕒 Modified: " -NoNewline -ForegroundColor Green
Write-Host "$($latestLog.LastWriteTime)" -ForegroundColor White
Write-Host ""
Write-Host "🎯 Status: " -NoNewline -ForegroundColor Green
Write-Host "Monitoring real-time events... " -NoNewline -ForegroundColor Yellow
Write-Host "(Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "─" * 75 -ForegroundColor DarkGray

# Monitor with beautiful formatting
try {
    Get-Content $latestLog.FullName -Wait -Tail 5 | ForEach-Object {
        if ($_.Trim()) {
            try {
                # Remove [AUDIT] prefix and parse JSON
                $jsonContent = $_ -replace '^\[AUDIT\]\s*', ''
                $logEntry = $jsonContent | ConvertFrom-Json -ErrorAction Stop
                Show-PrettyLogEntry $logEntry
            } catch {
                # Fallback for non-JSON lines
                $time = Get-Date -Format "HH:mm:ss.fff"
                Write-Host "📝 [$time] $_" -ForegroundColor DarkGray
                Write-Host ""
            }
        }
    }
} catch [System.OperationCanceledException] {
    Write-Host ""
    Write-Host "⏹️  Monitor stopped by user (Ctrl+C)" -ForegroundColor Yellow
} catch {
    Write-Host ""
    Write-Host "❌ Monitor error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Write-Host ""
    Write-Host "✅ Enterprise MCP Log Monitor stopped" -ForegroundColor Green
    Write-Host "👋 Thanks for monitoring your security intelligence!" -ForegroundColor Cyan
    if ($Host.Name -eq "ConsoleHost") {
        Read-Host "Press Enter to close"
    }
}
