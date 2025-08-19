#Requires -Version 5.1

<#
.SYNOPSIS
    Pure PowerShell MCP Client for testing Enterprise TypeScript MCP Server
    
.DESCRIPTION
    A simplified but functional MCP client implementation in PowerShell that properly handles:
    - JSON-RPC protocol communication  
    - Separation of stdout (JSON-RPC) from stderr (logging)
    - MCP initialize/tools/call workflow
    
.PARAMETER ServerPath
    Path to the MCP server executable (default: dist/vscode-server-enterprise.js)
    
.PARAMETER TestMode  
    Type of test to run: basic, tools, or interactive
    
.EXAMPLE
    .\Test-PowerShellMCP.ps1 -TestMode basic
#>

param(
    [string]$ServerPath = "dist/vscode-server-enterprise.js",
    [ValidateSet("basic", "tools", "interactive")]
    [string]$TestMode = "basic"
)

# ==============================================================================
# FUNCTIONS
# ==============================================================================

function Start-MCPServer {
    param([string]$ServerPath)
    
    Write-Host "🔧 Starting MCP server: $ServerPath" -ForegroundColor Yellow
    
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = $ServerPath
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    
    $process = [System.Diagnostics.Process]::Start($psi)
    
    if ($process) {
        Write-Host "✅ Server started (PID: $($process.Id))" -ForegroundColor Green
        Start-Sleep -Seconds 2
        return $process
    } else {
        throw "Failed to start MCP server"
    }
}

function Send-MCPRequest {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Method,
        [hashtable]$Params = @{},
        [int]$Id = 1
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
    Write-Host "📤 REQUEST: $json" -ForegroundColor Cyan
    
    # Send request
    $Process.StandardInput.WriteLine($json)
    $Process.StandardInput.Flush()
    
    # Read response (with timeout)
    $timeout = [DateTime]::Now.AddSeconds(10)
    $response = $null
    
    while ([DateTime]::Now -lt $timeout -and $response -eq $null) {
        if (-not $Process.StandardOutput.EndOfStream) {
            try {
                $line = $Process.StandardOutput.ReadLine()
                if ($line) {
                    Write-Host "📨 RESPONSE: $line" -ForegroundColor Green
                    $response = $line | ConvertFrom-Json
                    break
                }
            } catch {
                Write-Warning "Failed to parse response: $line"
            }
        }
        Start-Sleep -Milliseconds 100
    }
    
    if ($response -eq $null) {
        throw "No response received within timeout"
    }
    
    return $response
}

function Test-BasicMCP {
    param([System.Diagnostics.Process]$Process)
    
    Write-Host "`n🧪 Running Basic MCP Protocol Test..." -ForegroundColor Magenta
    
    # Test 1: Initialize
    Write-Host "`n🔗 Step 1: Initialize MCP connection" -ForegroundColor Yellow
    $initParams = @{
        protocolVersion = "2024-11-05"
        capabilities = @{}
        clientInfo = @{
            name = "powershell-mcp-test-client"
            version = "1.0.0"
        }
    }
    
    $initResponse = Send-MCPRequest -Process $Process -Method "initialize" -Params $initParams -Id 1
    
    if ($initResponse.result) {
        Write-Host "✅ Initialize successful!" -ForegroundColor Green
        Write-Host "   Server: $($initResponse.result.serverInfo.name)" -ForegroundColor Gray
        Write-Host "   Version: $($initResponse.result.serverInfo.version)" -ForegroundColor Gray
    } else {
        throw "Initialize failed: $($initResponse.error.message)"
    }
    
    # Test 2: List Tools
    Write-Host "`n🔧 Step 2: Get available tools" -ForegroundColor Yellow
    $toolsResponse = Send-MCPRequest -Process $Process -Method "tools/list" -Id 2
    
    if ($toolsResponse.result -and $toolsResponse.result.tools) {
        $tools = $toolsResponse.result.tools
        Write-Host "✅ Found $($tools.Count) tools:" -ForegroundColor Green
        foreach ($tool in $tools) {
            $desc = if ($tool.description.Length -gt 60) { $tool.description.Substring(0, 60) + "..." } else { $tool.description }
            Write-Host "   🛠️  $($tool.name): $desc" -ForegroundColor White
        }
        return $tools
    } else {
        throw "Failed to get tools: $($toolsResponse.error.message)"  
    }
}

function Test-ToolsExecution {
    param(
        [System.Diagnostics.Process]$Process,
        [array]$Tools
    )
    
    Write-Host "`n🧪 Running Tools Execution Test..." -ForegroundColor Magenta
    
    # Test help tool
    if ($Tools | Where-Object { $_.name -eq "help" }) {
        Write-Host "`n📖 Testing help tool..." -ForegroundColor Yellow
        $helpParams = @{
            name = "help"
            arguments = @{}
        }
        $helpResponse = Send-MCPRequest -Process $Process -Method "tools/call" -Params $helpParams -Id 3
        
        if ($helpResponse.result) {
            Write-Host "✅ Help tool executed successfully!" -ForegroundColor Green
        }
    }
    
    # Test syntax check tool
    if ($Tools | Where-Object { $_.name -eq "powershell-syntax-check" }) {
        Write-Host "`n🔍 Testing PowerShell syntax check..." -ForegroundColor Yellow
        $syntaxParams = @{
            name = "powershell-syntax-check"
            arguments = @{
                content = "Get-Process | Select-Object Name, CPU"
            }
        }
        $syntaxResponse = Send-MCPRequest -Process $Process -Method "tools/call" -Params $syntaxParams -Id 4
        
        if ($syntaxResponse.result) {
            Write-Host "✅ Syntax check executed successfully!" -ForegroundColor Green
        }
    }
    
    # Test safe PowerShell command
    if ($Tools | Where-Object { $_.name -eq "powershell-command" }) {
        Write-Host "`n⚡ Testing safe PowerShell command..." -ForegroundColor Yellow
        $cmdParams = @{
            name = "powershell-command"
            arguments = @{
                command = "Get-Date"
            }
        }
        $cmdResponse = Send-MCPRequest -Process $Process -Method "tools/call" -Params $cmdParams -Id 5
        
        if ($cmdResponse.result) {
            Write-Host "✅ PowerShell command executed successfully!" -ForegroundColor Green
            if ($cmdResponse.result.content -and $cmdResponse.result.content[0].text) {
                Write-Host "   Result: $($cmdResponse.result.content[0].text.Trim())" -ForegroundColor Gray
            }
        }
    }
}

function Start-InteractiveMode {
    param(
        [System.Diagnostics.Process]$Process,
        [array]$Tools
    )
    
    Write-Host "`n🎮 Entering Interactive Mode..." -ForegroundColor Magenta
    Write-Host "Available commands:" -ForegroundColor Gray
    Write-Host "  help               - Get server help" -ForegroundColor Gray
    Write-Host "  cmd <command>      - Execute PowerShell command" -ForegroundColor Gray
    Write-Host "  syntax <code>      - Check PowerShell syntax" -ForegroundColor Gray
    Write-Host "  test               - Run AI agent tests" -ForegroundColor Gray
    Write-Host "  quit               - Exit interactive mode" -ForegroundColor Gray
    Write-Host ""
    
    $requestId = 10
    
    while ($true) {
        $input = Read-Host "MCP> "
        
        if ($input -eq "quit" -or $input -eq "exit") {
            break
        }
        
        try {
            $requestId++
            
            switch -Regex ($input) {
                "^help$" {
                    $params = @{
                        name = "help"
                        arguments = @{}
                    }
                    $response = Send-MCPRequest -Process $Process -Method "tools/call" -Params $params -Id $requestId
                    if ($response.result.content) {
                        Write-Host $response.result.content[0].text -ForegroundColor White
                    }
                }
                "^cmd\s+(.+)" {
                    $command = $matches[1]
                    $params = @{
                        name = "powershell-command"
                        arguments = @{ command = $command }
                    }
                    $response = Send-MCPRequest -Process $Process -Method "tools/call" -Params $params -Id $requestId
                    if ($response.result.content) {
                        Write-Host $response.result.content[0].text -ForegroundColor White
                    }
                }
                "^syntax\s+(.+)" {
                    $code = $matches[1]
                    $params = @{
                        name = "powershell-syntax-check" 
                        arguments = @{ content = $code }
                    }
                    $response = Send-MCPRequest -Process $Process -Method "tools/call" -Params $params -Id $requestId
                    if ($response.result.content) {
                        Write-Host $response.result.content[0].text -ForegroundColor White
                    }
                }
                "^test$" {
                    $params = @{
                        name = "ai-agent-test"
                        arguments = @{ testSuite = "basic" }
                    }
                    $response = Send-MCPRequest -Process $Process -Method "tools/call" -Params $params -Id $requestId
                    if ($response.result.content) {
                        Write-Host $response.result.content[0].text -ForegroundColor White
                    }
                }
                default {
                    Write-Host "Unknown command. Available: help, cmd <command>, syntax <code>, test, quit" -ForegroundColor Yellow
                }
            }
        }
        catch {
            Write-Error "Command failed: $_"
        }
    }
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "🔧 Pure PowerShell MCP Client Test" -ForegroundColor Cyan  
Write-Host "===============================================" -ForegroundColor Cyan

$serverProcess = $null

try {
    # Start MCP server
    $serverProcess = Start-MCPServer -ServerPath $ServerPath
    
    # Run basic protocol test first
    $tools = Test-BasicMCP -Process $serverProcess
    
    # Run additional tests based on mode
    switch ($TestMode) {
        "basic" {
            Write-Host "`n✅ Basic MCP protocol test completed successfully!" -ForegroundColor Green
        }
        "tools" {
            Test-ToolsExecution -Process $serverProcess -Tools $tools
            Write-Host "`n✅ Tools execution test completed successfully!" -ForegroundColor Green
        }
        "interactive" {
            Start-InteractiveMode -Process $serverProcess -Tools $tools
        }
    }
    
    Write-Host "`n🎉 PowerShell MCP Client test completed!" -ForegroundColor Green
}
catch {
    Write-Error "❌ Test failed: $_"
    Write-Host $_.ScriptStackTrace -ForegroundColor Red
}
finally {
    # Clean shutdown
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Write-Host "`n🛑 Shutting down MCP server..." -ForegroundColor Yellow
        try {
            $serverProcess.Kill()
            $serverProcess.WaitForExit(5000)
            Write-Host "✅ Server shutdown complete." -ForegroundColor Green
        }
        catch {
            Write-Warning "Error stopping server: $_"
        }
    }
}
