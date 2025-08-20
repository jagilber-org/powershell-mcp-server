#Requires -Version 5.1

<#
.SYNOPSIS
    Simple Universal Enterprise MCP Log Monitor (No Emoji Issues)
.PARAMETER LogPath
    Specific log file path to monitor
.PARAMETER AutoDetect
    Auto-detect running MCP servers and their log files
#>

param(
    [string]$LogPath,
    [switch]$AutoDetect
)

function Show-PrettyLogEntry {
    param($JsonData, $SourceWorkspace = "")
    
    $timestamp = ([DateTime]$JsonData.timestamp).ToString("HH:mm:ss.fff")
    
    # Get colors based on level and category
    $levelColor = "White"; $messageColor = "Gray"
    
    switch ($JsonData.level) {
        "CRITICAL" { $levelColor = "Magenta"; $messageColor = "Red" }
        "ERROR"    { $levelColor = "Red"; $messageColor = "Red" }
        "WARNING"  { $levelColor = "Yellow"; $messageColor = "Yellow" }
        "INFO"     { $levelColor = "Cyan"; $messageColor = "White" }
        "DEBUG"    { $levelColor = "DarkGray"; $messageColor = "DarkGray" }
    }
    
    # Special category colors
    switch ($JsonData.category) {
        "ALIAS_DETECTED"      { $messageColor = "Cyan" }
        "UNKNOWN_THREAT"      { $messageColor = "Red" }
        "SUSPICIOUS_PATTERN"  { $messageColor = "Magenta" }
        "THREAT_ANALYSIS"     { $messageColor = "Yellow" }
        "TOOL_EXECUTION"      { $messageColor = "Green" }
        "AUTH_SUCCESS"        { $messageColor = "Green" }
        "AUTH_FAILED"         { $messageColor = "Red" }
        "AUTH_DISABLED"       { $messageColor = "Yellow" }
        "SYSTEM_INFO"         { $messageColor = "Blue" }
        "SERVER_START"        { $messageColor = "Green" }
        "SERVER_READY"        { $messageColor = "Green" }
        "SERVER_CONNECT"      { $messageColor = "Cyan" }
        "MCP_REQUEST"         { $messageColor = "Blue" }
        "MCP_ERROR"           { $messageColor = "Red" }
        "CONFIRMATION_REQUIRED" { $messageColor = "Yellow" }
    }
    
    # Main log line
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
            Write-Host "    Command: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$cmd" -ForegroundColor White
        }
        
        # Alias detection details
        if ($meta.originalAlias -and $meta.resolvedCmdlet) {
            Write-Host "    Alias: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.originalAlias)" -NoNewline -ForegroundColor Yellow
            Write-Host " -> " -NoNewline -ForegroundColor DarkGray  
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
            Write-Host "    Risk Level: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.riskLevel)" -ForegroundColor $riskColor
        }
        
        # Tool info
        if ($meta.toolName) {
            Write-Host "    Tool: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.toolName)" -ForegroundColor Cyan
        }
    }
    
    Write-Host "" # Blank line for readability
}

function Find-MCPLogFiles {
    Write-Host "Searching for MCP audit log files..." -ForegroundColor Yellow
    
    # Search locations
    $searchPaths = @(".", "..\*", "..\..\*")
    $foundLogs = @()
    
    foreach ($searchPath in $searchPaths) {
        try {
            $logs = Get-ChildItem -Path "$searchPath\logs\powershell-mcp-audit-*.log" -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.Length -gt 0 } |
                Sort-Object LastWriteTime -Descending
            
            $foundLogs += $logs
        } catch {
            # Ignore permission errors
        }
    }
    
    # Remove duplicates and sort by most recent
    $uniqueLogs = $foundLogs | Sort-Object FullName -Unique | Sort-Object LastWriteTime -Descending
    
    return $uniqueLogs
}

# Header
Clear-Host
$Host.UI.RawUI.WindowTitle = "Universal Enterprise MCP Log Monitor - Multi-Workspace"
Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "         UNIVERSAL ENTERPRISE MCP LOG MONITOR                          " -ForegroundColor Cyan  
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

# Find the log file to monitor
$targetLog = $null

if ($LogPath) {
    if (Test-Path $LogPath) {
        $targetLog = Get-Item $LogPath
        Write-Host "Using specified log file: $LogPath" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Specified log file not found: $LogPath" -ForegroundColor Red
        exit 1
    }
} else {
    # Auto-detect log files
    $allLogs = Find-MCPLogFiles
    
    if ($allLogs.Count -eq 0) {
        Write-Host "ERROR: No MCP audit log files found" -ForegroundColor Red
        Write-Host "Make sure an MCP server is running and generating logs" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
    
    if ($allLogs.Count -eq 1) {
        $targetLog = $allLogs[0]
        Write-Host "Auto-detected log file: " -NoNewline -ForegroundColor Green
        Write-Host "$($targetLog.FullName)" -ForegroundColor White
    } else {
        Write-Host "Found multiple MCP log files:" -ForegroundColor Yellow
        Write-Host ""
        for ($i = 0; $i -lt $allLogs.Count; $i++) {
            $log = $allLogs[$i]
            $workspace = Split-Path (Split-Path $log.FullName -Parent) -Leaf
            $timeDiff = (Get-Date) - $log.LastWriteTime
            $freshness = if ($timeDiff.TotalMinutes -lt 5) { "ACTIVE" } 
                        elseif ($timeDiff.TotalHours -lt 1) { "Recent" }
                        else { "Idle" }
            
            Write-Host "  [$($i+1)] " -NoNewline -ForegroundColor Cyan
            Write-Host "$workspace" -NoNewline -ForegroundColor White
            Write-Host " - " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($log.Name)" -NoNewline -ForegroundColor Gray
            Write-Host " (" -NoNewline -ForegroundColor DarkGray
            Write-Host "$([math]::Round($log.Length / 1KB, 1)) KB" -NoNewline -ForegroundColor Blue
            Write-Host ", " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($log.LastWriteTime.ToString('MM/dd HH:mm:ss'))" -NoNewline -ForegroundColor Blue
            Write-Host ") " -NoNewline -ForegroundColor DarkGray
            $statusColor = if ($freshness -eq "ACTIVE") { "Green" } elseif ($freshness -eq "Recent") { "Yellow" } else { "DarkGray" }
            Write-Host "$freshness" -ForegroundColor $statusColor
        }
        Write-Host ""
        Write-Host "  [A] " -NoNewline -ForegroundColor Magenta
        Write-Host "Monitor ALL log files simultaneously" -ForegroundColor Magenta
        Write-Host ""
        
        do {
            $choice = Read-Host "Select log file (1-$($allLogs.Count)), 'A' for all, or 'q' to quit"
            if ($choice -eq 'q') { exit 0 }
            
            if ($choice -eq 'A' -or $choice -eq 'a') {
                # Monitor all logs simultaneously
                Write-Host ""
                Write-Host "MULTI-WORKSPACE MONITORING MODE" -ForegroundColor Magenta
                Write-Host "Monitoring $($allLogs.Count) log files simultaneously:" -ForegroundColor Cyan
                
                foreach ($log in $allLogs) {
                    $workspace = Split-Path (Split-Path $log.FullName -Parent) -Leaf
                    Write-Host "   $workspace" -NoNewline -ForegroundColor Green
                    Write-Host " - $($log.Name)" -ForegroundColor White
                }
                
                Write-Host ""
                Write-Host "Status: Monitoring ALL workspaces in real-time... (Ctrl+C to stop)" -ForegroundColor Yellow
                Write-Host "-----------------------------------------------------------------------" -ForegroundColor DarkGray
                
                # Simple multi-file monitoring
                $filePositions = @{}
                $workspaceNames = @{}
                
                foreach ($log in $allLogs) {
                    $workspace = Split-Path (Split-Path $log.FullName -Parent) -Leaf
                    $filePositions[$log.FullName] = $log.Length
                    $workspaceNames[$log.FullName] = $workspace
                }
                
                try {
                    while ($true) {
                        foreach ($log in $allLogs) {
                            try {
                                $currentSize = (Get-Item $log.FullName -ErrorAction SilentlyContinue).Length
                                if ($currentSize -and $currentSize -gt $filePositions[$log.FullName]) {
                                    # Read new content from file
                                    $newLines = Get-Content $log.FullName -Tail ([int]($currentSize - $filePositions[$log.FullName]) / 100 + 1) -ErrorAction SilentlyContinue
                                    
                                    foreach ($line in $newLines) {
                                        if ($line.Trim()) {
                                            try {
                                                # Parse and display
                                                $jsonContent = $line -replace '^\[AUDIT\]\s*', ''
                                                $logEntry = $jsonContent | ConvertFrom-Json -ErrorAction Stop
                                                Show-PrettyLogEntry $logEntry $workspaceNames[$log.FullName]
                                            } catch {
                                                # Fallback display
                                                $time = Get-Date -Format "HH:mm:ss.fff"
                                                Write-Host "[$time] [$($workspaceNames[$log.FullName])] $line" -ForegroundColor DarkGray
                                                Write-Host ""
                                            }
                                        }
                                    }
                                    $filePositions[$log.FullName] = $currentSize
                                }
                            } catch {
                                # Skip file if error
                            }
                        }
                        Start-Sleep -Milliseconds 500
                    }
                } catch {
                    Write-Host ""
                    Write-Host "Multi-workspace monitoring stopped" -ForegroundColor Green
                }
                
                return
            }
            
            if ([int]$choice -ge 1 -and [int]$choice -le $allLogs.Count) {
                $targetLog = $allLogs[$choice - 1]
                break
            }
            Write-Host "Invalid choice. Please select 1-$($allLogs.Count), 'A' for all, or 'q'" -ForegroundColor Red
        } while ($true)
    }
}

# Single log monitoring
$workspace = Split-Path (Split-Path $targetLog.FullName -Parent) -Leaf
Write-Host ""
Write-Host "Workspace: " -NoNewline -ForegroundColor Green
Write-Host "$workspace" -ForegroundColor White
Write-Host "Log File: " -NoNewline -ForegroundColor Green
Write-Host "$($targetLog.Name)" -ForegroundColor White
Write-Host "Size: " -NoNewline -ForegroundColor Green
Write-Host "$([math]::Round($targetLog.Length / 1KB, 2)) KB" -ForegroundColor White
Write-Host ""
Write-Host "Status: Monitoring real-time events... (Ctrl+C to stop)" -ForegroundColor Yellow
Write-Host "-----------------------------------------------------------------------" -ForegroundColor DarkGray

# Monitor single file
try {
    Get-Content $targetLog.FullName -Wait -Tail 3 | ForEach-Object {
        if ($_.Trim()) {
            try {
                # Remove [AUDIT] prefix and parse JSON
                $jsonContent = $_ -replace '^\[AUDIT\]\s*', ''
                $logEntry = $jsonContent | ConvertFrom-Json -ErrorAction Stop
                Show-PrettyLogEntry $logEntry
            } catch {
                # Fallback for non-JSON lines
                $time = Get-Date -Format "HH:mm:ss.fff"
                Write-Host "[$time] $_" -ForegroundColor DarkGray
                Write-Host ""
            }
        }
    }
} catch {
    Write-Host ""
    Write-Host "Monitoring stopped" -ForegroundColor Green
} finally {
    Write-Host ""
    Write-Host "Universal Enterprise MCP Log Monitor stopped" -ForegroundColor Green
    if ($Host.Name -eq "ConsoleHost") {
        Read-Host "Press Enter to close"
    }
}
