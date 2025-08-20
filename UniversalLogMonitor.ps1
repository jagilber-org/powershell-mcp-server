#Requires -Version 5.1

<#
.SYNOPSIS    Write-Host "[*] Launching Universal MCP Monitor in new window..." -ForegroundColor Green
    Universal Enterpris    switch ($JsonData.level) {
        "CRITICAL" { $icon = "[*]"; $levelColor = "Magenta"; $messageColor = "Red" }
        "ERROR"    { $icon = [char]0x274C; $levelColor = "Red"; $messageColor $Host.UI.RawUI.WindowTitle = "[*]         if ($availableLogs.Count -eq 1) {
            $logFileToMonitor = $availableLogs[0].FullName
            $workspaceName = Get-WorkspaceInfo $logFileToMonitor
            Write-Host "[+] Auto-selected only available log: $logFileToMonitor" -ForegroundColor Green
        } else {
            # Auto-select the most recently modified file (likely the active one)
            $mostRecent = $availableLogs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            $recentAge = (Get-Date) - $mostRecent.LastWriteTime
            
            if ($recentAge.TotalMinutes -lt 30) {
                $logFileToMonitor = $mostRecent.FullName
                $workspaceName = Get-WorkspaceInfo $logFileToMonitor
                Write-Host "[+] Auto-selected most active log (modified $([math]::Round($recentAge.TotalMinutes, 1)) min ago): $($mostRecent.Name)" -ForegroundColor Green
            } else {
                # Show menu for selection
                Show-LogFileMenu $availableLogsal Enterprise MCP Log Monitor - Multi$Host.UI.RawUI.WindowTitle = "[*] Universal MCP Monitor - $workspaceName"Workspace" "Red" }
        "WARNING"  { $icon = [char]0x26A0; $levelColor = "Yellow"; $messageColor = "Yellow" }
        "INFO"     { $icon = [char]0x2139; $levelColor = "Cyan"; $messageColor = "White" }
        "DEBUG"    { $icon = "[*]"; $levelColor = "DarkGray"; $messageColor = "DarkGray" }
    }og Monitor - Auto-detect logs with workspace info menu
.PARAMETER LogPath
    Specific log file path to monitor
.PARAMETER AutoDetect
    Auto-detect running MCP servers and their log files
.PARAMETER NoNewWindow
    Skip launching in new window (for internal use)
#>

param(
    [string]$LogPath,
    [switch]$AutoDetect,
    [switch]$NoNewWindow
)

# Launch in new window unless explicitly told not to
if (-not $NoNewWindow) {
    $scriptPath = $MyInvocation.MyCommand.Path
    $arguments = @('-NoNewWindow')
    
    if ($LogPath) {
        $arguments += @('-LogPath', "`"$LogPath`"[*]")
    }
    if ($AutoDetect) {
        $arguments += @('-AutoDetect')
    }
    
    $argumentString = $arguments -join ' '
    
    Write-Host "$("[*]") Launching Universal MCP Monitor in new window..." -ForegroundColor Green
    
    # Create a wrapper command that keeps window open on error
    $wrapperCommand = @"
try {
    & '$scriptPath' $argumentString
} catch {
    Write-Host "$([char]0x274C) Error occurred: `$(`$_.Exception.Message)" -ForegroundColor Red
    Write-Host "Press any key to close..." -ForegroundColor Yellow
    `$null = `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
} finally {
    if (`$LASTEXITCODE -ne 0) {
        Write-Host "$([char]0x274C) Script exited with error code: `$LASTEXITCODE" -ForegroundColor Red
        Write-Host "Press any key to close..." -ForegroundColor Yellow
        `$null = `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    }
}
"@
    
    Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -Command `"$wrapperCommand`"" -WindowStyle Normal
    return
}

function Show-PrettyLogEntry {
    param($JsonData, $SourceWorkspace = "Unknown")
    
    $timestamp = ([DateTime]$JsonData.timestamp).ToString("HH:mm:ss.fff")
    
    # Get icon and colors based on level and category
    $icon = "[*]"; $levelColor = "White"; $messageColor = "Gray"
    
    switch ($JsonData.level) {
        "CRITICAL" { $icon = "[!]"; $levelColor = "Magenta"; $messageColor = "Red" }
        "ERROR"    { $icon = "[X]"; $levelColor = "Red"; $messageColor = "Red" }
        "WARNING"  { $icon = "$([char]0x26A0)"; $levelColor = "Yellow"; $messageColor = "Yellow" }
        "INFO"     { $icon = "$([char]0x2139)"; $levelColor = "Cyan"; $messageColor = "White" }
        "DEBUG"    { $icon = "[D]"; $levelColor = "DarkGray"; $messageColor = "DarkGray" }
    }
    
    # Special category icons
    switch ($JsonData.category) {
        "ALIAS_DETECTED"        { $icon = "[A]"; $messageColor = "Cyan" }
        "UNKNOWN_THREAT"        { $icon = "[!]"; $messageColor = "Red" }
        "SUSPICIOUS_PATTERN"    { $icon = "$([char]0x26A0)"; $messageColor = "Magenta" }
        "THREAT_ANALYSIS"       { $icon = "[T]"; $messageColor = "Yellow" }
        "TOOL_EXECUTION"        { $icon = "[X]"; $messageColor = "Green" }
        "AUTH_SUCCESS"          { $icon = "[+]"; $messageColor = "Green" }
        "AUTH_FAILED"           { $icon = "[-]"; $messageColor = "Red" }
        "AUTH_DISABLED"         { $icon = "$([char]0x26A0)"; $messageColor = "Yellow" }
        "SYSTEM_INFO"           { $icon = "[I]"; $messageColor = "Blue" }
        "SERVER_START"          { $icon = "[S]"; $messageColor = "Green" }
        "SERVER_READY"          { $icon = "[+]"; $messageColor = "Green" }
        "SERVER_CONNECT"        { $icon = "[C]"; $messageColor = "Cyan" }
        "MCP_REQUEST"           { $icon = "[Q]"; $messageColor = "Blue" }
        "MCP_ERROR"             { $icon = "[X]"; $messageColor = "Red" }
        "CONFIRMATION_REQUIRED" { $icon = "[?]"; $messageColor = "Yellow" }
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
            Write-Host "    $("[*]") Command: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$cmd" -ForegroundColor White
        }
        
        # Alias detection details
        if ($meta.originalAlias -and $meta.resolvedCmdlet) {
            Write-Host "    $("[*]") Alias: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.originalAlias)" -NoNewline -ForegroundColor Yellow
            Write-Host " $([char]0x2192) " -NoNewline -ForegroundColor DarkGray  
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
            Write-Host "    $([char]0x26A0) Risk Level: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.riskLevel)" -ForegroundColor $riskColor
        }
        
        # Tool/request info
        if ($meta.toolName) {
            Write-Host "    $("[*]") Tool: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.toolName)" -ForegroundColor Cyan
        }
        
        # Request ID for tracking
        if ($meta.requestId) {
            Write-Host "    $("[*]") Request: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.requestId)" -ForegroundColor Blue
        }
        
        # Server PID for identification
        if ($meta.serverPid) {
            Write-Host "    $("[*]") Server PID: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($meta.serverPid)" -ForegroundColor Blue
        }
        
        # Working directory for identification
        if ($meta.cwd) {
            $shortPath = Split-Path $meta.cwd -Leaf
            Write-Host "    $("[*]") Workspace: " -NoNewline -ForegroundColor DarkGray
            Write-Host "$shortPath" -ForegroundColor Blue
        }
    }
    
    Write-Host "" # Blank line for readability
}

function Find-RunningMCPServers {
    Write-Host "[*] Checking for running MCP server processes..." -ForegroundColor Yellow
    
    $mcpProcesses = @()
    
    try {
        # Look for PowerShell processes that might be MCP servers
        $psProcesses = Get-Process -Name "pwsh", "powershell" -ErrorAction SilentlyContinue
        
        foreach ($proc in $psProcesses) {
            try {
                # Try to get command line (requires admin or same user)
                $commandLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue).CommandLine
                
                if ($commandLine -and ($commandLine -like "*mcp*" -or $commandLine -like "*server*" -or $commandLine -like "*vscode-server*")) {
                    # Try to extract working directory from command line
                    $workingDir = $null
                    
                    # Look for common patterns to extract paths
                    if ($commandLine -match '"([^"]+\\[^"]*mcp[^"]*)"') {
                        $workingDir = Split-Path $matches[1] -Parent
                    } elseif ($commandLine -match "'([^']+\\[^']*mcp[^']*)'") {
                        $workingDir = Split-Path $matches[1] -Parent
                    } elseif ($commandLine -match '([A-Za-z]:\\[^\\s]+\\[^\\s]*mcp[^\\s]*)') {
                        $workingDir = Split-Path $matches[1] -Parent
                    }
                    
                    if ($workingDir -and (Test-Path $workingDir)) {
                        $mcpProcesses += @{
                            ProcessId = $proc.Id
                            ProcessName = $proc.ProcessName
                            WorkingDirectory = $workingDir
                            CommandLine = $commandLine
                        }
                        Write-Host "  [+] Found MCP process: PID $($proc.Id) in $workingDir" -ForegroundColor Green
                    }
                }
            } catch {
                # Skip processes we can't access
            }
        }
        
        # Also look for Node.js processes (TypeScript MCP servers)
        $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
        
        foreach ($proc in $nodeProcesses) {
            try {
                $commandLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue).CommandLine
                
                if ($commandLine -and ($commandLine -like "*mcp*" -or $commandLine -like "*server*")) {
                    # Extract working directory
                    $workingDir = $null
                    
                    if ($commandLine -match '"([^"]+\\[^"]*mcp[^"]*)"') {
                        $workingDir = Split-Path $matches[1] -Parent
                    } elseif ($commandLine -match '([A-Za-z]:\\[^\\s]+\\[^\\s]*mcp[^\\s]*)') {
                        $workingDir = Split-Path $matches[1] -Parent
                    }
                    
                    if ($workingDir -and (Test-Path $workingDir)) {
                        $mcpProcesses += @{
                            ProcessId = $proc.Id
                            ProcessName = $proc.ProcessName
                            WorkingDirectory = $workingDir
                            CommandLine = $commandLine
                        }
                        Write-Host "  [+] Found Node MCP process: PID $($proc.Id) in $workingDir" -ForegroundColor Green
                    }
                }
            } catch {
                # Skip processes we can't access
            }
        }
        
    } catch {
        Write-Host "  [!] Limited process access - some MCP servers may not be detected" -ForegroundColor Yellow
    }
    
    return $mcpProcesses
}

function Find-MCPLogFiles {
    Write-Host "[*] Searching for MCP audit log files..." -ForegroundColor Yellow

    # Skip slow process detection for faster startup
    # $runningServers = Find-RunningMCPServers
    
    # Build search paths from common locations
    $searchPaths = @(
        ".",
        "..\*",
        "..\..\*",
        "$env:USERPROFILE\*",
        "$env:USERPROFILE"
    )
    
    # Process detection disabled for faster startup
    # foreach ($server in $runningServers) {
    #     $serverPath = $server.WorkingDirectory
    #     if ($serverPath -and (Test-Path $serverPath)) {
    #         $searchPaths += $serverPath
    #         $searchPaths += "$serverPath\*"
    #     }
    # }
    
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

function Get-WorkspaceInfo {
    param($LogPath)
    
    # Try to determine workspace from path
    $parentDir = Split-Path (Split-Path $LogPath -Parent) -Leaf
    if ($parentDir -and $parentDir -ne "logs") {
        return $parentDir
    }
    
    # Look for package.json or other workspace indicators
    $searchDir = Split-Path (Split-Path $LogPath -Parent) -Parent
    if (Test-Path "$searchDir\package.json") {
        try {
            $packageContent = Get-Content "$searchDir\package.json" | ConvertFrom-Json
            if ($packageContent.name) {
                return $packageContent.name
            }
        } catch {
            # Ignore JSON parsing errors
        }
    }
    
    # Fallback to directory name
    return Split-Path $searchDir -Leaf
}

function Show-LogFileMenu {
    param($LogFiles)
    
    Write-Host "`n$("[*]") Available MCP Log Files:" -ForegroundColor Green
    Write-Host "$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor DarkGray
    
    for ($i = 0; $i -lt $LogFiles.Count; $i++) {
        $log = $LogFiles[$i]
        $workspace = Get-WorkspaceInfo $log.FullName
        $lastModified = $log.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
        $sizeKB = [math]::Round($log.Length / 1KB, 1)
        
        # Status indicator - consider files from today as recent
        $isRecent = $log.LastWriteTime -gt (Get-Date).Date
        $statusIcon = if ($isRecent) { "[+]" } else { "[-]" }
        $statusText = if ($isRecent) { "RECENT" } else { "OLDER" }
        
        Write-Host "  [$($i + 1)] " -NoNewline -ForegroundColor Cyan
        Write-Host "$statusIcon " -NoNewline
        Write-Host "$workspace" -NoNewline -ForegroundColor Yellow
        Write-Host " | " -NoNewline -ForegroundColor DarkGray
        Write-Host "$lastModified" -NoNewline -ForegroundColor White
        Write-Host " | " -NoNewline -ForegroundColor DarkGray
        Write-Host "${sizeKB}KB" -NoNewline -ForegroundColor Green
        Write-Host " | " -NoNewline -ForegroundColor DarkGray
        Write-Host "$statusText" -ForegroundColor $(if ($isRecent) { "Green" } else { "Gray" })
        Write-Host "      $("[*]") $($log.FullName)" -ForegroundColor DarkGray
    }
    
    Write-Host "$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor DarkGray
    Write-Host "  [0] Exit" -ForegroundColor Red
    Write-Host "[*]"
}

# Beautiful header
Clear-Host
$Host.UI.RawUI.WindowTitle = "$("[*]") Universal Enterprise MCP Log Monitor - Multi-Workspace"

Write-Host ""
Write-Host "[*] " -NoNewline -ForegroundColor Green
Write-Host "Universal Enterprise MCP Log Monitor" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host "$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor DarkGray
Write-Host "   [I] Real-time audit log monitoring with workspace detection" -ForegroundColor Gray
Write-Host "   [S] Auto-detection of MCP servers across multiple workspaces" -ForegroundColor Gray
Write-Host "   [F] Enhanced formatting with security threat visualization" -ForegroundColor Gray
Write-Host "$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)$([char]0x2550)" -ForegroundColor DarkGray

# Determine log file to monitor
$logFileToMonitor = $null
$workspaceName = "Unknown"

try {
    if ($LogPath -and (Test-Path $LogPath)) {
        $logFileToMonitor = $LogPath
        $workspaceName = Get-WorkspaceInfo $LogPath
        Write-Host "$("[*]") Using specified log file: $LogPath" -ForegroundColor Green
    } else {
        # Find available log files
        $availableLogs = Find-MCPLogFiles
        
        if ($availableLogs.Count -eq 0) {
            Write-Host "$([char]0x274C) No MCP audit log files found!" -ForegroundColor Red
            Write-Host "   $("[*]") Make sure MCP servers are running or have run recently" -ForegroundColor Yellow
            Write-Host "Press any key to close..." -ForegroundColor Yellow
            $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
            exit 1
        }
        
        if ($availableLogs.Count -eq 1) {
            $logFileToMonitor = $availableLogs[0].FullName
            $workspaceName = Get-WorkspaceInfo $logFileToMonitor
            Write-Host "$("[*]") Auto-selected only available log: $logFileToMonitor" -ForegroundColor Green
        } else {
            # Show menu for selection
            Show-LogFileMenu $availableLogs
            
            do {
                Write-Host "Please select a log file to monitor (1-$($availableLogs.Count), 0 to exit): " -NoNewline -ForegroundColor Yellow
                $selection = Read-Host
                
                if ($selection -eq "0") {
                    Write-Host "$("[*]") Exiting..." -ForegroundColor Yellow
                    exit 0
                }
                
                $selectionNum = $null
                if ([int]::TryParse($selection, [ref]$selectionNum) -and $selectionNum -ge 1 -and $selectionNum -le $availableLogs.Count) {
                    $logFileToMonitor = $availableLogs[$selectionNum - 1].FullName
                    $workspaceName = Get-WorkspaceInfo $logFileToMonitor
                    break
                } else {
                    Write-Host "$([char]0x274C) Invalid selection. Please enter a number between 1 and $($availableLogs.Count), or 0 to exit." -ForegroundColor Red
                }
            } while ($true)
        }
    }
} catch {
    Write-Host "$([char]0x274C) Error during initialization: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Press any key to close..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    exit 1
}

Write-Host "`n$("[*]") Monitoring log file:" -ForegroundColor Green
Write-Host "   $("[*]") Workspace: $workspaceName" -ForegroundColor Yellow  
Write-Host "   $("[*]") File: $logFileToMonitor" -ForegroundColor Cyan
Write-Host "   $([char]0x23F0) Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "[*]"
Write-Host "$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)" -ForegroundColor DarkGray
Write-Host "$("[*]") Monitoring Started - Press Ctrl+C to stop" -ForegroundColor Green
Write-Host "$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)$([char]0x2500)" -ForegroundColor DarkGray
Write-Host "[*]"

# Update window title with workspace info
$Host.UI.RawUI.WindowTitle = "$("[*]") Universal MCP Monitor - $workspaceName"

# Read existing content first (most robust approach)
if (Test-Path $logFileToMonitor) {
    $existingContent = Get-Content $logFileToMonitor -Raw
    if ($existingContent) {
        $lines = $existingContent -split "`n"
        foreach ($line in $lines) {
            $trimmedLine = $line.Trim()
            if ($trimmedLine -and $trimmedLine.StartsWith('[AUDIT]')) {
                try {
                    $jsonPart = $trimmedLine.Substring(7)
                    $logData = $jsonPart | ConvertFrom-Json
                    Show-PrettyLogEntry $logData $workspaceName
                } catch {
                    # Skip malformed lines
                }
            }
        }
    }
}

# Set up robust file monitoring using Get-Content -Wait (most reliable method)
try {
    Write-Host "$("[*]") Live monitoring active..." -ForegroundColor Green
    
    # Use Get-Content -Wait for robust real-time monitoring
    Get-Content $logFileToMonitor -Wait | ForEach-Object {
        $line = $_.Trim()
        if ($line -and $line.StartsWith('[AUDIT]')) {
            try {
                $jsonPart = $line.Substring(7)
                $logData = $jsonPart | ConvertFrom-Json
                Show-PrettyLogEntry $logData $workspaceName
            } catch {
                Write-Host "$([char]0x26A0)  Malformed log entry: $line" -ForegroundColor Yellow
            }
        }
    }
} catch {
    Write-Host "$([char]0x274C) Error monitoring file: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Press any key to close..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    exit 1
}




