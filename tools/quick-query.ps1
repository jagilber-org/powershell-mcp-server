# Quick Query Script for PowerShell MCP Server
# Usage: .\quick-query.ps1 -Command "Get-Date" -Key "ABC12345"

param(
    [Parameter(Mandatory=$true)]
    [string]$Command,
    
    [Parameter(Mandatory=$true)]
    [string]$Key,
    
    [Parameter(Mandatory=$false)]
    [string]$ServerUrl = "http://localhost:8383",
    
    [Parameter(Mandatory=$false)]
    [switch]$Health,
    
    [Parameter(Mandatory=$false)]
    [switch]$Terminate,
    
    [Parameter(Mandatory=$false)]
    [switch]$Pretty
)

function Send-QuickQuery {
    param(
        [string]$Url,
        [string]$Description
    )
    
    Write-Host "📤 $Description" -ForegroundColor Cyan
    Write-Host "🔗 URL: $Url" -ForegroundColor Gray
    
    try {
        $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 30
        
        Write-Host "✅ Response received:" -ForegroundColor Green
        
        if ($Pretty) {
            $response | ConvertTo-Json -Depth 10 | Write-Host
        } else {
            # Simple output
            if ($response.output) {
                Write-Host "Output: $($response.output)" -ForegroundColor White
            }
            if ($response.success -ne $null) {
                Write-Host "Success: $($response.success)" -ForegroundColor $(if($response.success) {"Green"} else {"Red"})
            }
            if ($response.duration_ms) {
                Write-Host "Duration: $($response.duration_ms)ms" -ForegroundColor Yellow
            }
            if ($response.error) {
                Write-Host "Error: $($response.error)" -ForegroundColor Red
            }
            if ($response.message) {
                Write-Host "Message: $($response.message)" -ForegroundColor White
            }
        }
        
        return $response
    }
    catch {
        Write-Host "❌ Request failed: $($_.Exception.Message)" -ForegroundColor Red
        
        # Common troubleshooting
        if ($_.Exception.Message -like "*refused*" -or $_.Exception.Message -like "*timeout*") {
            Write-Host "💡 Troubleshooting:" -ForegroundColor Yellow
            Write-Host "   1. Is the server running? Start with: .\ps-http-server.ps1 -Mode server" -ForegroundColor Gray
            Write-Host "   2. Check the port - server shows actual port on startup" -ForegroundColor Gray
            Write-Host "   3. Verify the server key matches" -ForegroundColor Gray
        }
        
        return $null
    }
}

# Main execution
if ($Health) {
    $url = "$ServerUrl/health?key=$Key"
    Send-QuickQuery -Url $url -Description "Health Check"
}
elseif ($Terminate) {
    $url = "$ServerUrl/terminate?key=$Key"
    Send-QuickQuery -Url $url -Description "Terminate Server"
}
elseif ($Command) {
    $encodedCmd = [System.Web.HttpUtility]::UrlEncode($Command)
    $url = "$ServerUrl/?key=$Key&cmd=$encodedCmd"
    Send-QuickQuery -Url $url -Description "Execute Command: '$Command'"
}
else {
    Write-Host "❌ No action specified. Use -Command, -Health, or -Terminate" -ForegroundColor Red
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host '  .\quick-query.ps1 -Command "Get-Date" -Key "ABC12345"' -ForegroundColor White
    Write-Host '  .\quick-query.ps1 -Health -Key "ABC12345"' -ForegroundColor White
    Write-Host '  .\quick-query.ps1 -Terminate -Key "ABC12345"' -ForegroundColor White
    Write-Host '  .\quick-query.ps1 -Command "Get-Process" -Key "ABC12345" -Pretty' -ForegroundColor White
}
