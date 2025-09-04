#Requires -Version 5.1

<#
.SYNOPSIS
    Pure PowerShell MCP Client for testing Enterprise TypeScript MCP Server
    
.DESCRIPTION
    A comprehensive MCP client implementation in PowerShell that properly handles:
    - JSON-RPC protocol communication
    - Separation of stdout (JSON-RPC) from stderr (logging)
    - MCP initialize/tools/call workflow
    - Interactive testing capabilities
    
.PARAMETER ServerPath
    Path to the MCP server executable (default: dist/server.js)
    
.PARAMETER TestMode
    Type of test to run: basic, interactive, tools, or comprehensive
    
.PARAMETER Timeout
    Timeout in seconds for server responses (default: 30)
    
.EXAMPLE
    .\Test-MCPClient.ps1 -TestMode basic
    
.EXAMPLE
    .\Test-MCPClient.ps1 -TestMode interactive
#>

param(
    [string]$ServerPath = "dist/server.js",
    [ValidateSet("basic", "interactive", "tools", "comprehensive")]
    [string]$TestMode = "basic",
    [int]$Timeout = 30
)

# ==============================================================================
# POWERSHELL MCP CLIENT IMPLEMENTATION
# ==============================================================================

class MCPClient {
    [System.Diagnostics.Process]$ServerProcess
    [int]$RequestId = 0
    [hashtable]$PendingRequests = @{}
    [bool]$IsConnected = $false
    [string]$ServerVersion
    [array]$AvailableTools = @()
    
    # Initialize MCP client
    MCPClient([string]$serverPath) {
        Write-Host "🚀 Initializing PowerShell MCP Client..." -ForegroundColor Cyan
        Write-Host "📍 Server Path: $serverPath" -ForegroundColor Gray
        
        if (-not (Test-Path $serverPath)) {
            throw "Server file not found: $serverPath"
        }
        
        $this.StartServer($serverPath)
    }
    
    # Start the MCP server process
    [void] StartServer([string]$serverPath) {
        Write-Host "🔧 Starting MCP server process..." -ForegroundColor Yellow
        
        $processInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processInfo.FileName = "node"
        $processInfo.Arguments = $serverPath
        $processInfo.UseShellExecute = $false
        $processInfo.RedirectStandardInput = $true
        $processInfo.RedirectStandardOutput = $true
        $processInfo.RedirectStandardError = $true
        $processInfo.CreateNoWindow = $true
        
        $this.ServerProcess = New-Object System.Diagnostics.Process
        $this.ServerProcess.StartInfo = $processInfo
        
        # Event handlers for async output reading
        $this.ServerProcess.add_OutputDataReceived({
            param($sender, $e)
            if ($e.Data) {
                $this.HandleStdoutData($e.Data)
            }
        })
        
        $this.ServerProcess.add_ErrorDataReceived({
            param($sender, $e)
            if ($e.Data) {
                Write-Host "📤 SERVER LOG: $($e.Data)" -ForegroundColor DarkGray
            }
        })
        
        try {
            $this.ServerProcess.Start()
            $this.ServerProcess.BeginOutputReadLine()
            $this.ServerProcess.BeginErrorReadLine()
            
            Write-Host "✅ Server process started (PID: $($this.ServerProcess.Id))" -ForegroundColor Green
            Start-Sleep -Seconds 2  # Give server time to initialize
        }
        catch {
            throw "Failed to start server: $_"
        }
    }
    
    # Handle JSON-RPC data from stdout
    [void] HandleStdoutData([string]$data) {
        try {
            $response = $data | ConvertFrom-Json
            Write-Host "📨 RESPONSE: $($response | ConvertTo-Json -Compress)" -ForegroundColor Green
            
            if ($response.id -and $this.PendingRequests.ContainsKey($response.id)) {
                $this.PendingRequests[$response.id] = $response
            }
        }
        catch {
            Write-Warning "Invalid JSON received from server: $data"
        }
    }
    
    # Send JSON-RPC request to server
    [object] SendRequest([string]$method, [object]$params = $null) {
        $this.RequestId++
        
        $request = @{
            jsonrpc = "2.0"
            id = $this.RequestId
            method = $method
        }
        
        if ($params) {
            $request.params = $params
        }
        
        $json = $request | ConvertTo-Json -Depth 10 -Compress
        Write-Host "📤 REQUEST: $json" -ForegroundColor Cyan
        
        # Send to server stdin
        $this.ServerProcess.StandardInput.WriteLine($json)
        $this.ServerProcess.StandardInput.Flush()
        
        # Mark as pending
        $this.PendingRequests[$this.RequestId] = $null
        
        # Wait for response
        $timeout = [DateTime]::Now.AddSeconds(30)
        while ([DateTime]::Now -lt $timeout) {
            if ($this.PendingRequests[$this.RequestId]) {
                $response = $this.PendingRequests[$this.RequestId]
                $this.PendingRequests.Remove($this.RequestId)
                return $response
            }
            Start-Sleep -Milliseconds 100
        }
        
        throw "Request timeout for method: $method"
    }
    
    # Initialize MCP connection
    [void] Initialize() {
        Write-Host "`n🔗 Initializing MCP connection..." -ForegroundColor Yellow
        
        $params = @{
            protocolVersion = "2024-11-05"
            capabilities = @{}
            clientInfo = @{
                name = "powershell-mcp-client"
                version = "1.0.0"
            }
        }
        
        $response = $this.SendRequest("initialize", $params)
        
        if ($response.result) {
            $this.IsConnected = $true
            $this.ServerVersion = $response.result.serverInfo.version
            Write-Host "✅ MCP connection established!" -ForegroundColor Green
            Write-Host "📋 Server: $($response.result.serverInfo.name)" -ForegroundColor Gray
            Write-Host "📋 Version: $($response.result.serverInfo.version)" -ForegroundColor Gray
            Write-Host "📋 Protocol: $($response.result.protocolVersion)" -ForegroundColor Gray
        }
        else {
            throw "Failed to initialize MCP connection: $($response.error.message)"
        }
    }
    
    # Get list of available tools
    [void] GetTools() {
        Write-Host "`n🔧 Retrieving available tools..." -ForegroundColor Yellow
        
        $response = $this.SendRequest("tools/list")
        
        if ($response.result -and $response.result.tools) {
            $this.AvailableTools = $response.result.tools
            Write-Host "✅ Found $($this.AvailableTools.Count) tools:" -ForegroundColor Green
            
            foreach ($tool in $this.AvailableTools) {
                Write-Host "  🛠️  $($tool.name) - $($tool.description.Substring(0, [Math]::Min(80, $tool.description.Length)))..." -ForegroundColor White
            }
        }
        else {
            throw "Failed to get tools: $($response.error.message)"
        }
    }
    
    # Call a specific tool
    [object] CallTool([string]$toolName, [object]$arguments = @{}) {
        Write-Host "`n⚡ Calling tool: $toolName" -ForegroundColor Yellow
        
        $params = @{
            name = $toolName
            arguments = $arguments
        }
        
        $response = $this.SendRequest("tools/call", $params)
        
        if ($response.result) {
            Write-Host "✅ Tool execution completed!" -ForegroundColor Green
            return $response.result
        }
        else {
            Write-Warning "Tool execution failed: $($response.error.message)"
            return $response
        }
    }
    
    # Run interactive mode
    [void] RunInteractive() {
        Write-Host "`n🎮 Entering interactive mode..." -ForegroundColor Magenta
        Write-Host "Available commands:" -ForegroundColor Gray
        Write-Host "  help          - Get help from server" -ForegroundColor Gray
        Write-Host "  test          - Run AI agent tests" -ForegroundColor Gray
        Write-Host "  cmd <command> - Execute PowerShell command" -ForegroundColor Gray
        Write-Host "  syntax <code> - Check PowerShell syntax" -ForegroundColor Gray
        Write-Host "  quit          - Exit interactive mode" -ForegroundColor Gray
        Write-Host ""
        
        while ($true) {
            $input = Read-Host "MCP> "
            
            if ($input -eq "quit" -or $input -eq "exit") {
                break
            }
            
            try {
                switch -Regex ($input) {
                    "^help$" {
                        $result = $this.CallTool("help")
                        if ($result.content) {
                            Write-Host $result.content[0].text -ForegroundColor White
                        }
                    }
                    "^test$" {
                        $result = $this.CallTool("ai_agent_test", @{ testSuite = "basic" })
                        if ($result.content) {
                            Write-Host $result.content[0].text -ForegroundColor White
                        }
                    }
                    "^cmd (.+)" {
                        $command = $matches[1]
                        $result = $this.CallTool("powershell-command", @{ command = $command })
                        if ($result.content) {
                            Write-Host $result.content[0].text -ForegroundColor White
                        }
                    }
                    "^syntax (.+)" {
                        $code = $matches[1]
                        $result = $this.CallTool("powershell-syntax-check", @{ content = $code })
                        if ($result.content) {
                            Write-Host $result.content[0].text -ForegroundColor White
                        }
                    }
                    default {
                        Write-Host "Unknown command. Type 'help' for server help or 'quit' to exit." -ForegroundColor Yellow
                    }
                }
            }
            catch {
                Write-Error "Command failed: $_"
            }
        }
    }
    
    # Clean shutdown
    [void] Shutdown() {
        Write-Host "`n🛑 Shutting down MCP client..." -ForegroundColor Yellow
        
        if ($this.ServerProcess -and -not $this.ServerProcess.HasExited) {
            try {
                $this.ServerProcess.Kill()
                $this.ServerProcess.WaitForExit(5000)
            }
            catch {
                Write-Warning "Error stopping server process: $_"
            }
        }
        
        Write-Host "✅ MCP client shutdown complete." -ForegroundColor Green
    }
}

# ==============================================================================
# TEST FUNCTIONS
# ==============================================================================

function Test-BasicMCP {
    param([MCPClient]$client)
    
    Write-Host "`n🧪 Running Basic MCP Test..." -ForegroundColor Magenta
    
    # Initialize connection
    $client.Initialize()
    
    # Get available tools
    $client.GetTools()
    
    Write-Host "✅ Basic MCP test completed successfully!" -ForegroundColor Green
}

function Test-ToolsCommunication {
    param([MCPClient]$client)
    
    Write-Host "`n🧪 Running Tools Communication Test..." -ForegroundColor Magenta
    
    # Initialize connection
    $client.Initialize()
    $client.GetTools()
    
    # Test help tool
    Write-Host "`n📖 Testing help tool..." -ForegroundColor Yellow
    $helpResult = $client.CallTool("help")
    
    # Test syntax check
    Write-Host "`n🔍 Testing syntax check tool..." -ForegroundColor Yellow
    $syntaxResult = $client.CallTool("powershell_syntax_check", @{ content = "Get-Process" })
    
    # Test safe command
    Write-Host "`n⚡ Testing safe PowerShell command..." -ForegroundColor Yellow
    $cmdResult = $client.CallTool("powershell_command", @{ command = "Get-Date" })
    
    Write-Host "✅ Tools communication test completed!" -ForegroundColor Green
}

function Test-Comprehensive {
    param([MCPClient]$client)
    
    Write-Host "`n🧪 Running Comprehensive Test..." -ForegroundColor Magenta
    
    Test-BasicMCP $client
    Test-ToolsCommunication $client
    
    # Test AI agent validation
    Write-Host "`n🤖 Testing AI agent validation..." -ForegroundColor Yellow
    $testResult = $client.CallTool("ai_agent_test", @{ testSuite = "basic"; skipDangerous = $true })
    
    Write-Host "✅ Comprehensive test completed!" -ForegroundColor Green
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

function Main {
    Write-Host "===============================================" -ForegroundColor Cyan
    Write-Host "🔧 PowerShell MCP Client for Enterprise Server" -ForegroundColor Cyan
    Write-Host "===============================================" -ForegroundColor Cyan
    
    $client = $null
    
    try {
        # Create MCP client
        $client = [MCPClient]::new($ServerPath)
        
        # Run selected test mode
        switch ($TestMode) {
            "basic" {
                Test-BasicMCP $client
            }
            "tools" {
                Test-ToolsCommunication $client
            }
            "interactive" {
                $client.Initialize()
                $client.GetTools()
                $client.RunInteractive()
            }
            "comprehensive" {
                Test-Comprehensive $client
            }
        }
        
        Write-Host "`n🎉 Test completed successfully!" -ForegroundColor Green
    }
    catch {
        Write-Error "❌ Test failed: $_"
        Write-Host $_.ScriptStackTrace -ForegroundColor Red
    }
    finally {
        if ($client) {
            $client.Shutdown()
        }
    }
}

# Run the main function
Main
