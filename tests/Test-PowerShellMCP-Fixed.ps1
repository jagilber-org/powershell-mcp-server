#Requires -Version 5.1

<#
.SYNOPSIS
    Improved PowerShell MCP Client - Fixed buffering and timeouts
.DESCRIPTION
    A pure PowerShell MCP client that properly handles server responses
    and doesn't hang on tools/call operations.
#>

function Start-MCPServer {
    Write-Host "🚀 Starting MCP Server..." -ForegroundColor Green
    
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "dist/server.js"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true  # Capture stderr too
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $PWD.Path
    
    $process = [System.Diagnostics.Process]::Start($psi)
    
    # Give server time to start
    Start-Sleep -Seconds 3
    
    if ($process.HasExited) {
        throw "MCP Server failed to start (exit code: $($process.ExitCode))"
    }
    
    Write-Host "✅ MCP Server started (PID: $($process.Id))" -ForegroundColor Green
    return $process
}

function Send-MCPRequest {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Method,
        [hashtable]$Params = @{},
        [int]$Id = 1,
        [int]$TimeoutSeconds = 30  # Increased timeout
    )
    
    $request = @{
        jsonrpc = "2.0"
        id = $Id
        method = $Method
    }
    
    if ($Params.Count -gt 0) {
        $request.params = $Params
    }
    
    $json = $request | ConvertTo-Json -Depth 10 -Compress
    Write-Host "📤 Sending: $Method" -ForegroundColor Cyan
    
    # Send request
    $Process.StandardInput.WriteLine($json)
    $Process.StandardInput.Flush()
    
    # Read response with improved buffering
    $timeout = [DateTime]::Now.AddSeconds($TimeoutSeconds)
    $responses = @()
    
    while ([DateTime]::Now -lt $timeout) {
        # Check if process died
        if ($Process.HasExited) {
            Write-Error "MCP Server process has exited (code: $($Process.ExitCode))"
            break
        }
        
        # Check for stderr messages (but don't block on them)
        while (-not $Process.StandardError.EndOfStream) {
            $errorLine = $Process.StandardError.ReadLine()
            if ($errorLine) {
                Write-Host "🔍 STDERR: $errorLine" -ForegroundColor DarkGray
            }
        }
        
        # Read stdout responses
        if (-not $Process.StandardOutput.EndOfStream) {
            try {
                $line = $Process.StandardOutput.ReadLine()
                if ($line -and $line.Trim().StartsWith('{"')) {
                    Write-Host "📨 Response: $($line.Substring(0, [Math]::Min(100, $line.Length)))..." -ForegroundColor Green
                    $response = $line | ConvertFrom-Json
                    
                    # Check if this is the response we're looking for
                    if ($response.id -eq $Id) {
                        return $response
                    } else {
                        $responses += $response
                    }
                }
            } catch {
                # Ignore parse errors - might be partial lines
                Write-Host "🔍 Parse error (ignoring): $($_.Exception.Message)" -ForegroundColor DarkGray
            }
        }
        
        Start-Sleep -Milliseconds 50
    }
    
    Write-Error "Timeout waiting for response to $Method (waited $TimeoutSeconds seconds)"
    return $null
}

function Test-MCPProtocol {
    $process = $null
    try {
        $process = Start-MCPServer
        
        # Test 1: Initialize
        Write-Host "`n🔗 Test 1: Initialize" -ForegroundColor Yellow
        $initParams = @{
            protocolVersion = "2024-11-05"
            capabilities = @{}
            clientInfo = @{
                name = "powershell-mcp-client"
                version = "2.0.0"
            }
        }
        
        $response = Send-MCPRequest -Process $process -Method "initialize" -Params $initParams -Id 1
        if ($response -and $response.result) {
            Write-Host "✅ Initialize OK: $($response.result.serverInfo.name)" -ForegroundColor Green
        } else {
            Write-Host "❌ Initialize failed" -ForegroundColor Red
            return
        }
        
        # Test 2: List tools
        Write-Host "`n🛠️  Test 2: List Tools" -ForegroundColor Yellow
        $response = Send-MCPRequest -Process $process -Method "tools/list" -Id 2
        if ($response -and $response.result) {
            Write-Host "✅ Tools/list OK: Found $($response.result.tools.Count) tools" -ForegroundColor Green
            foreach ($tool in $response.result.tools) {
                Write-Host "   - $($tool.name)" -ForegroundColor White
            }
        } else {
            Write-Host "❌ Tools/list failed" -ForegroundColor Red
            return
        }
        
        # Test 3: Call syntax check (fast)
        Write-Host "`n⚡ Test 3: Call Tool (syntax-check)" -ForegroundColor Yellow
        $toolParams = @{
            name = "powershell-syntax-check"
            arguments = @{
                content = "Get-Process | Select-Object Name, Id"
            }
        }
        
        $response = Send-MCPRequest -Process $process -Method "tools/call" -Params $toolParams -Id 3 -TimeoutSeconds 15
        if ($response -and $response.result) {
            Write-Host "✅ Syntax check OK!" -ForegroundColor Green
            $result = $response.result.content[0].text | ConvertFrom-Json
            Write-Host "   Valid: $($result.isValid), Errors: $($result.errors.Count)" -ForegroundColor White
        } else {
            Write-Host "❌ Syntax check failed" -ForegroundColor Red
        }
        
        # Test 4: Call PowerShell command (might be slower)
        Write-Host "`n🔧 Test 4: Call Tool (powershell-command)" -ForegroundColor Yellow
        $toolParams = @{
            name = "powershell-command"
            arguments = @{
                command = "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"
            }
        }
        
        $response = Send-MCPRequest -Process $process -Method "tools/call" -Params $toolParams -Id 4 -TimeoutSeconds 20
        if ($response -and $response.result) {
            Write-Host "✅ PowerShell command OK!" -ForegroundColor Green
            $result = $response.result.content[0].text | ConvertFrom-Json
            Write-Host "   Output: $($result.stdout)" -ForegroundColor White
            Write-Host "   Duration: $($result.duration_ms)ms" -ForegroundColor Gray
        } else {
            Write-Host "❌ PowerShell command failed" -ForegroundColor Red
        }
        
        Write-Host "`n🎉 All tests completed!" -ForegroundColor Green
        
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    } finally {
        if ($process -and -not $process.HasExited) {
            Write-Host "`n🛑 Stopping MCP Server..." -ForegroundColor Yellow
            $process.Kill()
            $process.WaitForExit(5000)
            Write-Host "✅ Server stopped" -ForegroundColor Green
        }
    }
}

# Run the test
Test-MCPProtocol
