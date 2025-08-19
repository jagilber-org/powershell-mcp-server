#Requires -Version 5.1

<#
.SYNOPSIS
    Quick PowerShell MCP Client Test - Non-hanging version
    
.DESCRIPTION
    A simplified MCP client that handles responses better and doesn't hang
    
.PARAMETER TestMode
    Type of test: basic, quick, or single
    
.EXAMPLE
    .\Quick-MCPTest.ps1 -TestMode basic
#>

param(
    [ValidateSet("basic", "quick", "single")]
    [string]$TestMode = "basic"
)

function Send-MCPRequestQuick {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Method,
        [hashtable]$Params = @{},
        [int]$Id = 1,
        [int]$TimeoutSeconds = 5
    )
    
    $request = @{
        jsonrpc = "2.0"
        id = $Id
        method = $Method
    }
    
    if ($Params.Count -gt 0) {
        $request.params = $Params
    }
    
    $json = $request | ConvertTo-Json -Depth 5 -Compress
    Write-Host "📤 REQUEST: $Method" -ForegroundColor Cyan
    
    # Send request
    $Process.StandardInput.WriteLine($json)
    $Process.StandardInput.Flush()
    
    # Read response with shorter timeout and better error handling
    $timeout = [DateTime]::Now.AddSeconds($TimeoutSeconds)
    
    while ([DateTime]::Now -lt $timeout) {
        try {
            if ($Process.HasExited) {
                throw "Server process has exited"
            }
            
            # Check if data is available
            if (-not $Process.StandardOutput.EndOfStream) {
                $line = $Process.StandardOutput.ReadLine()
                if ($line -and $line.StartsWith('{"')) {
                    Write-Host "📨 RESPONSE: $Method ✅" -ForegroundColor Green
                    $response = $line | ConvertFrom-Json
                    return $response
                }
            }
        } catch {
            Write-Warning "Error reading response: $_"
            break
        }
        Start-Sleep -Milliseconds 50
    }
    
    Write-Warning "⏰ Timeout waiting for response to: $Method"
    return $null
}

function Test-QuickMCP {
    Write-Host "🧪 Quick MCP Test Starting..." -ForegroundColor Magenta
    
    # Start server
    Write-Host "🔧 Starting server..." -ForegroundColor Yellow
    
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "dist/vscode-server-enterprise.js"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    
    $process = [System.Diagnostics.Process]::Start($psi)
    
    if (-not $process) {
        throw "Failed to start server"
    }
    
    Write-Host "✅ Server started (PID: $($process.Id))" -ForegroundColor Green
    Start-Sleep -Seconds 2
    
    try {
        # Test 1: Initialize (quick)
        Write-Host "`n🔗 Test 1: Initialize" -ForegroundColor Yellow
        $initParams = @{
            protocolVersion = "2024-11-05"
            capabilities = @{}
            clientInfo = @{
                name = "quick-test"
                version = "1.0.0"
            }
        }
        
        $initResponse = Send-MCPRequestQuick -Process $process -Method "initialize" -Params $initParams -Id 1 -TimeoutSeconds 3
        
        if ($initResponse -and $initResponse.result) {
            Write-Host "   ✅ Initialize: SUCCESS" -ForegroundColor Green
            Write-Host "   📋 Server: $($initResponse.result.serverInfo.name)" -ForegroundColor Gray
        } else {
            Write-Host "   ❌ Initialize: FAILED" -ForegroundColor Red
            return
        }
        
        if ($TestMode -eq "single") {
            Write-Host "`n🎉 Single test completed!" -ForegroundColor Green
            return
        }
        
        # Test 2: List tools (quick)
        Write-Host "`n🔧 Test 2: List Tools" -ForegroundColor Yellow
        $toolsResponse = Send-MCPRequestQuick -Process $process -Method "tools/list" -Id 2 -TimeoutSeconds 3
        
        if ($toolsResponse -and $toolsResponse.result -and $toolsResponse.result.tools) {
            $toolCount = $toolsResponse.result.tools.Count
            Write-Host "   ✅ Tools List: SUCCESS ($toolCount tools)" -ForegroundColor Green
        } else {
            Write-Host "   ❌ Tools List: FAILED" -ForegroundColor Red
        }
        
        if ($TestMode -eq "basic") {
            Write-Host "`n🎉 Basic test completed!" -ForegroundColor Green
            return
        }
        
        # Test 3: Quick tool call (syntax check - should be fast)
        Write-Host "`n⚡ Test 3: Quick Tool Call (syntax check)" -ForegroundColor Yellow
        $toolParams = @{
            name = "powershell-syntax-check"
            arguments = @{
                content = "Get-Date"
            }
        }
        
        $toolResponse = Send-MCPRequestQuick -Process $process -Method "tools/call" -Params $toolParams -Id 3 -TimeoutSeconds 5
        
        if ($toolResponse -and $toolResponse.result) {
            Write-Host "   ✅ Tool Call: SUCCESS" -ForegroundColor Green
        } else {
            Write-Host "   ❌ Tool Call: FAILED or TIMEOUT" -ForegroundColor Red
        }
        
        Write-Host "`n🎉 Quick test completed!" -ForegroundColor Green
        
    } catch {
        Write-Error "Test failed: $_"
    } finally {
        # Clean shutdown
        if ($process -and -not $process.HasExited) {
            Write-Host "`n🛑 Stopping server..." -ForegroundColor Yellow
            try {
                $process.Kill()
                $process.WaitForExit(3000)
                Write-Host "✅ Server stopped" -ForegroundColor Green
            } catch {
                Write-Warning "Error stopping server: $_"
            }
        }
    }
}

# Run the test
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "🔧 Quick PowerShell MCP Test" -ForegroundColor Cyan  
Write-Host "===============================================" -ForegroundColor Cyan

Test-QuickMCP
