#Requires -Version 5.1

<#
.SYNOPSIS
    Quick Test of Alias Detection and Threat Tracking
#>

Write-Host "🔍 Quick Security Test..." -ForegroundColor Cyan

# Test just the threat analysis tool
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"  
$psi.Arguments = "dist/vscode-server-enterprise.js"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$process = [System.Diagnostics.Process]::Start($psi)
Write-Host "✅ Server started" -ForegroundColor Green

try {
    Start-Sleep -Seconds 2
    
    # Initialize
    $init = @{
        jsonrpc = "2.0"
        id = 1
        method = "initialize"
        params = @{
            protocolVersion = "2024-11-05"
            capabilities = @{}
            clientInfo = @{ name = "test"; version = "1.0" }
        }
    } | ConvertTo-Json -Compress
    
    $process.StandardInput.WriteLine($init)
    $process.StandardInput.Flush()
    Start-Sleep -Seconds 1
    
    # Consume init response
    if (-not $process.StandardOutput.EndOfStream) {
        $null = $process.StandardOutput.ReadLine()
    }
    
    # Test alias command
    Write-Host "📤 Testing alias 'ls'..." -ForegroundColor Yellow
    $aliasTest = @{
        jsonrpc = "2.0"
        id = 2
        method = "tools/call"
        params = @{
            name = "powershell-command"
            arguments = @{ command = "ls" }
        }
    } | ConvertTo-Json -Compress
    
    $process.StandardInput.WriteLine($aliasTest)
    $process.StandardInput.Flush()
    Start-Sleep -Seconds 3
    
    # Check for stderr (logs)
    while (-not $process.StandardError.EndOfStream) {
        $errorLine = $process.StandardError.ReadLine()
        if ($errorLine -and $errorLine.Contains("ALIAS_DETECTED")) {
            Write-Host "✅ ALIAS DETECTED: $errorLine" -ForegroundColor Green
        }
    }
    
    # Get threat analysis
    Write-Host "📊 Getting threat analysis..." -ForegroundColor Yellow
    $threatRequest = @{
        jsonrpc = "2.0"
        id = 3
        method = "tools/call"
        params = @{
            name = "threat-analysis"
            arguments = @{ includeDetails = $true }
        }
    } | ConvertTo-Json -Compress
    
    $process.StandardInput.WriteLine($threatRequest)
    $process.StandardInput.Flush()
    
    # Wait for response
    $timeout = [DateTime]::Now.AddSeconds(8)
    while ([DateTime]::Now -lt $timeout) {
        if (-not $process.StandardOutput.EndOfStream) {
            $line = $process.StandardOutput.ReadLine()
            if ($line -and $line.Contains('threat-analysis')) {
                Write-Host "📨 Threat Response: $($line.Substring(0, [Math]::Min(200, $line.Length)))..." -ForegroundColor Green
                
                try {
                    $response = $line | ConvertFrom-Json
                    if ($response.result) {
                        $analysis = $response.result.content[0].text | ConvertFrom-Json
                        Write-Host "🚨 Risk: $($analysis.assessment.overallRisk)" -ForegroundColor Red
                        Write-Host "⚠️  Threats: $($analysis.statistics.uniqueThreats)" -ForegroundColor Yellow
                        Write-Host "🔍 Aliases: $($analysis.statistics.aliasesDetected)" -ForegroundColor Cyan
                    }
                } catch {
                    Write-Host "Parse error: $($_.Exception.Message)" -ForegroundColor DarkGray
                }
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    
    Write-Host "✅ Security test complete!" -ForegroundColor Green
    
} finally {
    if ($process -and -not $process.HasExited) {
        $process.Kill()
        $process.WaitForExit(2000)
    }
}
