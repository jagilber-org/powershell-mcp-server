#Requires -Version 5.1

<#
.SYNOPSIS
    Test PowerShell Alias Detection and Threat Tracking
.DESCRIPTION
    Tests the enhanced security features including alias detection,
    unknown command tracking, and threat analysis.
#>

Write-Host "🔍 Testing Enhanced Security Features..." -ForegroundColor Cyan

# Start server manually for debugging
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "dist/server.js"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $false  # Let stderr show on console
$psi.CreateNoWindow = $true

$process = [System.Diagnostics.Process]::Start($psi)
Write-Host "✅ Server started (PID: $($process.Id))" -ForegroundColor Green

try {
    Start-Sleep -Seconds 3
    
    # Initialize
    Write-Host "`n📤 Initializing..." -ForegroundColor Yellow
    $init = @{
        jsonrpc = "2.0"
        id = 1
        method = "initialize"
        params = @{
            protocolVersion = "2024-11-05"
            capabilities = @{}
            clientInfo = @{
                name = "security-test-client"
                version = "1.0.0"
            }
        }
    } | ConvertTo-Json -Depth 5 -Compress
    
    $process.StandardInput.WriteLine($init)
    $process.StandardInput.Flush()
    Start-Sleep -Seconds 2
    $initResponse = $process.StandardOutput.ReadLine()
    Write-Host "📨 Initialize OK" -ForegroundColor Green
    
    # Test 1: Known alias (should be detected)
    Write-Host "`n🧪 Test 1: Testing known PowerShell alias 'ls'" -ForegroundColor Yellow
    $toolCall = @{
        jsonrpc = "2.0"
        id = 2
        method = "tools/call"
        params = @{
            name = "powershell-command"
            arguments = @{
                command = "ls C:\Windows"
            }
        }
    } | ConvertTo-Json -Depth 5 -Compress
    
    $process.StandardInput.WriteLine($toolCall)
    $process.StandardInput.Flush()
    Start-Sleep -Seconds 5
    
    # Test 2: Suspicious alias (should be flagged)
    Write-Host "`n🧪 Test 2: Testing suspicious command 'iex'" -ForegroundColor Yellow
    $toolCall = @{
        jsonrpc = "2.0"
        id = 3
        method = "tools/call"
        params = @{
            name = "powershell-command"
            arguments = @{
                command = "iex 'Get-Date'"
            }
        }
    } | ConvertTo-Json -Depth 5 -Compress
    
    $process.StandardInput.WriteLine($toolCall)
    $process.StandardInput.Flush()
    Start-Sleep -Seconds 3
    
    # Test 3: Unknown command (should be tracked)
    Write-Host "`n🧪 Test 3: Testing unknown command" -ForegroundColor Yellow
    $toolCall = @{
        jsonrpc = "2.0"
        id = 4
        method = "tools/call"
        params = @{
            name = "powershell-command"
            arguments = @{
                command = "SomeUnknownCommand-WithParameters -Flag1 -Value test"
            }
        }
    } | ConvertTo-Json -Depth 5 -Compress
    
    $process.StandardInput.WriteLine($toolCall)
    $process.StandardInput.Flush()
    Start-Sleep -Seconds 3
    
    # Test 4: Get threat analysis
    Write-Host "`n🔍 Test 4: Getting threat analysis report" -ForegroundColor Yellow
    $threatAnalysis = @{
        jsonrpc = "2.0"
        id = 5
        method = "tools/call"
        params = @{
            name = "threat-analysis"
            arguments = @{
                includeDetails = $true
                resetStats = $false
            }
        }
    } | ConvertTo-Json -Depth 5 -Compress
    
    $process.StandardInput.WriteLine($threatAnalysis)
    $process.StandardInput.Flush()
    
    # Wait for response
    Write-Host "⏱️  Waiting for threat analysis response..." -ForegroundColor Yellow
    $timeout = [DateTime]::Now.AddSeconds(10)
    $response = $null
    
    while ([DateTime]::Now -lt $timeout -and -not $response) {
        if (-not $process.StandardOutput.EndOfStream) {
            $line = $process.StandardOutput.ReadLine()
            if ($line -and $line.StartsWith('{"')) {
                $response = $line
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    
    if ($response) {
        Write-Host "📨 Threat Analysis Response Received!" -ForegroundColor Green
        $parsed = $response | ConvertFrom-Json
        if ($parsed.result) {
            $analysis = $parsed.result.content[0].text | ConvertFrom-Json
            Write-Host "🚨 Overall Risk: $($analysis.assessment.overallRisk)" -ForegroundColor White
            Write-Host "⚠️  Threat Level: $($analysis.assessment.threatLevel)" -ForegroundColor White
            Write-Host "📊 Unique Threats: $($analysis.statistics.uniqueThreats)" -ForegroundColor White
            Write-Host "🔍 Aliases Detected: $($analysis.statistics.aliasesDetected)" -ForegroundColor White
            Write-Host "⚡ Commands Processed: $($analysis.commandsProcessed)" -ForegroundColor White
        }
    } else {
        Write-Host "⏰ No response received" -ForegroundColor Red
    }
    
    Write-Host "`n🎉 Enhanced Security Test Complete!" -ForegroundColor Green
    
} finally {
    # Cleanup
    if ($process -and -not $process.HasExited) {
        Write-Host "`n🛑 Stopping server..." -ForegroundColor Yellow
        $process.Kill()
        $process.WaitForExit(3000)
    }
    Write-Host "✅ Test complete" -ForegroundColor Green
}
