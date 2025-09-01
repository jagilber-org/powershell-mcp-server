#Requires -Version 5.1

<#
.SYNOPSIS
    Simple Working Enterprise MCP Log Monitor - Actually shows logs!
#>

param(
    [string]$LogPath
)

function Show-PrettyLogEntry {
    param($JsonData, $SourceWorkspace = "")
    
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
    
    # Main log line with workspace prefix if provided
    Write-Host "$icon " -NoNewline -ForegroundColor $levelColor
    Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
    if ($SourceWorkspace) {
        Write-Host "[$SourceWorkspace] " -NoNewline -ForegroundColor Magenta
    }
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
    }
    
    Write-Host "" # Blank line for readability
}

# Beautiful header
Clear-Host
$Host.UI.RawUI.WindowTitle = "🔍 Simple Working MCP Log Monitor"
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                🔍 SIMPLE WORKING MCP LOG MONITOR                    ║" -ForegroundColor Cyan  
Write-Host "╚═══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Find log file to monitor
if ($LogPath -and (Test-Path $LogPath)) {
    $targetLog = Get-Item $LogPath
    Write-Host "📌 Using specified log file: $LogPath" -ForegroundColor Green
} else {
    # Look for log files in current workspace
    $logFiles = Get-ChildItem "logs\powershell-mcp-audit-*.log" -ErrorAction SilentlyContinue | 
        Sort-Object LastWriteTime -Descending
    
    if (-not $logFiles) {
        Write-Host "❌ No MCP audit log files found in logs directory" -ForegroundColor Red
        Write-Host "📁 Current directory: $(Get-Location)" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
    
    $targetLog = $logFiles[0]
    Write-Host "🎯 Using latest log file: " -NoNewline -ForegroundColor Green
    Write-Host "$($targetLog.Name)" -ForegroundColor White
}

# Display log info
Write-Host ""
Write-Host "📄 Log File: " -NoNewline -ForegroundColor Green
Write-Host "$($targetLog.Name)" -ForegroundColor White
Write-Host "📊 Size: " -NoNewline -ForegroundColor Green
Write-Host "$([math]::Round($targetLog.Length / 1KB, 2)) KB" -ForegroundColor White
Write-Host "🕒 Modified: " -NoNewline -ForegroundColor Green
Write-Host "$($targetLog.LastWriteTime)" -ForegroundColor White
Write-Host ""

# Show recent entries first
Write-Host "📜 Recent log entries:" -ForegroundColor Yellow
Write-Host "─" * 75 -ForegroundColor DarkGray

$recentLines = Get-Content $targetLog.FullName -Tail 5
foreach ($line in $recentLines) {
    if ($line.Trim()) {
        try {
            $jsonContent = $line -replace '^\[AUDIT\]\s*', ''
            $logEntry = $jsonContent | ConvertFrom-Json -ErrorAction Stop
            Show-PrettyLogEntry $logEntry
        } catch {
            $time = Get-Date -Format "HH:mm:ss.fff"
            Write-Host "📝 [$time] $line" -ForegroundColor DarkGray
            Write-Host ""
        }
    }
}

Write-Host ""
Write-Host "🎯 Now monitoring for new entries... " -NoNewline -ForegroundColor Green
Write-Host "(Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host "─" * 75 -ForegroundColor DarkGray

# Monitor for new entries using Get-Content -Wait (simple and reliable)
try {
    Get-Content $targetLog.FullName -Wait -Tail 0 | ForEach-Object {
        if ($_.Trim()) {
            try {
                $jsonContent = $_ -replace '^\[AUDIT\]\s*', ''
                $logEntry = $jsonContent | ConvertFrom-Json -ErrorAction Stop
                Show-PrettyLogEntry $logEntry
            } catch {
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
    Write-Host "✅ Simple MCP Log Monitor stopped" -ForegroundColor Green
    Write-Host "👋 Thanks for monitoring!" -ForegroundColor Cyan
    if ($Host.Name -eq "ConsoleHost") {
        Read-Host "Press Enter to close"
    }
}
