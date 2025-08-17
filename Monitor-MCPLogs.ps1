# PowerShell MCP Server Log Monitor
# This script monitors the MCP server audit logs and displays them in a readable format

param(
    [string]$LogPath = "C:\github\jagilber-pr\powershell-mcp-server\logs",
    [switch]$Follow = $false,
    [switch]$PrettyPrint = $true,
    [string]$FilterLevel = "",
    [string]$FilterCategory = ""
)

function Format-LogEntry {
    param($LogLine)
    
    if ($LogLine -match '^\[AUDIT\]\s*(.*)$') {
        $jsonPart = $matches[1]
        try {
            $logObject = $jsonPart | ConvertFrom-Json
            
            # Apply filters
            if ($FilterLevel -and $logObject.level -ne $FilterLevel) { return $null }
            if ($FilterCategory -and $logObject.category -ne $FilterCategory) { return $null }
            
            if ($PrettyPrint) {
                $output = @"

🕒 $($logObject.timestamp)
📊 [$($logObject.level)] $($logObject.category)
📝 $($logObject.message)
"@
                if ($logObject.metadata) {
                    $output += "`n🔍 Metadata:"
                    $logObject.metadata.PSObject.Properties | ForEach-Object {
                        $output += "`n   • $($_.Name): $($_.Value)"
                    }
                }
                $output += "`n" + "─" * 80
                return $output
            } else {
                return $LogLine
            }
        } catch {
            return "❌ Failed to parse log entry: $LogLine"
        }
    }
    return $LogLine
}

# Find the most recent log file
$logFiles = Get-ChildItem -Path $LogPath -Filter "powershell-mcp-audit-*.log" | Sort-Object LastWriteTime -Descending

if (-not $logFiles) {
    Write-Host "❌ No log files found in $LogPath" -ForegroundColor Red
    Write-Host "💡 Execute some PowerShell MCP commands to generate logs first" -ForegroundColor Yellow
    exit 1
}

$latestLogFile = $logFiles[0].FullName
Write-Host "📖 Monitoring log file: $latestLogFile" -ForegroundColor Green

if ($FilterLevel) {
    Write-Host "🔍 Filtering by level: $FilterLevel" -ForegroundColor Cyan
}
if ($FilterCategory) {
    Write-Host "🔍 Filtering by category: $FilterCategory" -ForegroundColor Cyan
}

Write-Host "═" * 80 -ForegroundColor DarkGray

if ($Follow) {
    Write-Host "👀 Following log file (Press Ctrl+C to stop)..." -ForegroundColor Yellow
    Get-Content -Path $latestLogFile -Wait | ForEach-Object {
        $formatted = Format-LogEntry $_
        if ($formatted) {
            Write-Host $formatted
        }
    }
} else {
    # Show existing content
    Get-Content -Path $latestLogFile | ForEach-Object {
        $formatted = Format-LogEntry $_
        if ($formatted) {
            Write-Host $formatted
        }
    }
}
