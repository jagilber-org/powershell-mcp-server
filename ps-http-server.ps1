# PowerShell HTTP Server/Client Script
# Can operate as server (listener) or client (sender)
# Server auto-generates key if not provided and tries alternate ports if needed
# Client uses key for authentication

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('server', 'client', 'test')]
    [string]$Mode = 'server',
    
    [Parameter(Mandatory=$false)]
    [string]$Command = '',
    
    [Parameter(Mandatory=$false)]
    [string]$ServerUrl = 'http://localhost:8383',
    
    [Parameter(Mandatory=$false)]
    [string]$Key = '',  # Auto-generate if empty
    
    [Parameter(Mandatory=$false)]
    [int]$Port = 8383,  # Try alternate ports if blocked
    
    [Parameter(Mandatory=$false)]
    [switch]$Terminate
)

# Generate random key if not provided
if ([string]::IsNullOrEmpty($Key)) {
    $Key = -join ((1..8) | ForEach { [char]((65..90) + (97..122) + (48..57) | Get-Random) })
    Write-Host "🔑 Auto-generated key: $Key" -ForegroundColor Yellow
}

function Test-AutoExecutionSafety {
    param([string]$Command)
    
    # Based on Microsoft's official PowerShell verb classifications
    # Reference: https://learn.microsoft.com/en-us/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands
    
    # HIGH RISK verbs from Security and Lifecycle groups that could cause system harm
    $highRiskVerbs = @(
        # Security group - potentially dangerous
        'Block', 'Revoke',                    # Restrict/remove access
        'Unblock', 'Unprotect',              # Remove security safeguards
        
        # Lifecycle group - system modifications
        'Install', 'Uninstall',              # Software installation/removal
        'Register', 'Unregister',            # System component registration
        
        # Common group - destructive operations
        'Remove', 'Clear',                   # Delete/clear operations
        
        # Additional high-risk operations not in standard groups
        'Stop', 'Restart', 'Reset',          # Service/system control
        'Delete', 'Kill', 'Terminate'        # Destructive operations
    )
    
    # SPECIFIC HIGH-RISK PATTERNS (regardless of verb classification)
    $highRiskPatterns = @(
        # Critical system operations
        'Stop-Process.*explorer',            # Kill Windows Explorer
        'Stop-Process.*winlogon',            # Kill Windows logon
        'Restart-Computer',                  # Reboot system  
        'Stop-Service.*Critical',            # Stop critical services
        'Set-ExecutionPolicy',               # Change security policy
        
        # File system risks
        'Remove-Item.*C:\\Windows',          # Delete from Windows directory
        'Remove-Item.*C:\\Program Files',    # Delete from Program Files
        'Clear-.*EventLog',                  # Clear event logs
        'Format-.*Volume',                   # Format drives
        
        # Registry and system configuration
        '.*Registry.*HKLM',                  # Modify machine-wide registry
        'New-.*User',                        # Create user accounts
        'Remove-.*User',                     # Delete user accounts
        
        # Network and domain risks
        'Join-Domain', 'Unjoin-Domain',      # Domain operations
        'New-.*Share'                        # Create network shares (no trailing comma)
    )
    
    # Extract the first verb from the command
    $verb = ($Command -split '[-\s]')[0]
    
    # Check against high-risk verbs
    if ($highRiskVerbs -contains $verb) {
        return $false  # Requires confirmation
    }
    
    # Check against specific high-risk patterns
    foreach ($pattern in $highRiskPatterns) {
        if ($Command -match $pattern) {
            return $false  # Requires confirmation
        }
    }
    
    # If no high-risk patterns matched, it's safe for automation
    # This includes: Get, Show, Find, Test, Measure, Compare, Select, Where, Sort, Group, Format
    # As well as: Set-Location, Get-Content, Write-Host, Export-Csv (to logs), etc.
    return $true
}

function Start-PowerShellHttpServer {
    param(
        [int]$StartPort = 8383,
        [string]$Key
    )
    
    $listener = $null
    $actualPort = $StartPort
    $maxAttempts = 10
    $attempt = 0
    
    # Try to find an available port
    while ($attempt -lt $maxAttempts) {
        $testPort = $StartPort + $attempt
        
        try {
            $listener = New-Object System.Net.HttpListener
            $prefix = "http://localhost:$testPort/"
            $listener.Prefixes.Add($prefix)
            $listener.Start()
            
            $actualPort = $testPort
            Write-Host "✅ PowerShell HTTP Server started on $prefix" -ForegroundColor Green
            Write-Host "🔑 Server key: $Key" -ForegroundColor Yellow
            Write-Host "📋 Copy this for client use: -ServerUrl http://localhost:$testPort -Key $Key" -ForegroundColor Cyan
            Write-Host "🛑 Send /terminate request to stop server gracefully" -ForegroundColor Cyan
            
            if ($attempt -gt 0) {
                Write-Host "ℹ️  Note: Port $StartPort was busy, using port $testPort instead" -ForegroundColor Yellow
            }
            Write-Host ""
            break
        }
        catch {
            if ($listener) {
                $listener.Dispose()
                $listener = $null
            }
            
            Write-Host "⚠️  Port $testPort is busy, trying next port..." -ForegroundColor Yellow
            $attempt++
            
            if ($attempt -ge $maxAttempts) {
                Write-Host "❌ Unable to find available port after $maxAttempts attempts" -ForegroundColor Red
                Write-Host "   Ports tried: $StartPort to $($StartPort + $maxAttempts - 1)" -ForegroundColor Red
                return
            }
        }
    }
    
    if (-not $listener -or -not $listener.IsListening) {
        Write-Host "❌ Failed to start HTTP server" -ForegroundColor Red
        return
    }
    
    try {
        $running = $true
        while ($running -and $listener.IsListening) {
            try {
                # Wait for request
                $context = $listener.GetContext()
                $request = $context.Request
                $response = $context.Response
                
                Write-Host "📥 Request: $($request.HttpMethod) $($request.Url)" -ForegroundColor Blue
                
                # Parse query parameters
                $clientKey = $request.QueryString['key']
                $cmd = $request.QueryString['cmd']
                $terminate = $request.QueryString['terminate']
                
                # Set response headers
                $response.Headers.Add("Access-Control-Allow-Origin", "*")
                $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
                $response.ContentType = "application/json"
                
                # Handle OPTIONS request
                if ($request.HttpMethod -eq 'OPTIONS') {
                    $response.StatusCode = 200
                    $response.Close()
                    continue
                }
                
                # Validate key
                if ($clientKey -ne $Key) {
                    $errorResponse = @{
                        error = "Invalid key"
                        timestamp = (Get-Date).ToString('o')
                    } | ConvertTo-Json
                    
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes($errorResponse)
                    $response.StatusCode = 401
                    $response.ContentLength64 = $buffer.Length
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                    $response.Close()
                    
                    Write-Host "❌ Invalid key from client: $clientKey" -ForegroundColor Red
                    continue
                }
                
                # Handle terminate request
                if ($terminate -eq 'true' -or $request.Url.AbsolutePath -eq '/terminate') {
                    $terminateResponse = @{
                        message = "Server terminating gracefully"
                        timestamp = (Get-Date).ToString('o')
                    } | ConvertTo-Json
                    
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes($terminateResponse)
                    $response.StatusCode = 200
                    $response.ContentLength64 = $buffer.Length
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                    $response.Close()
                    
                    Write-Host "🛑 Terminate request received. Stopping server..." -ForegroundColor Yellow
                    $running = $false
                    break
                }
                
                # Handle health check
                if ($request.Url.AbsolutePath -eq '/health') {
                    $healthResponse = @{
                        status = "healthy"
                        server = "PowerShell HTTP Server"
                        timestamp = (Get-Date).ToString('o')
                        port = $Port
                    } | ConvertTo-Json
                    
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes($healthResponse)
                    $response.StatusCode = 200
                    $response.ContentLength64 = $buffer.Length
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                    $response.Close()
                    
                    Write-Host "💚 Health check successful" -ForegroundColor Green
                    continue
                }
                
                # Handle PowerShell command execution
                if ($cmd) {
                    # Check if command is safe for automatic execution
                    $isSafeForAuto = Test-AutoExecutionSafety -Command $cmd
                    
                    if (-not $isSafeForAuto) {
                        Write-Host "⚠️  Command requires confirmation: $cmd" -ForegroundColor Yellow
                        
                        $warningResponse = @{
                            command = $cmd
                            warning = "Command potentially modifies system state and requires confirmation"
                            suggestion = "Use safe read-only commands (Get-, Show-, Test-Path, etc.)"
                            requires_confirmation = $true
                            safe_alternatives = @(
                                "Get-Process", "Get-Service", "Get-ChildItem", "Get-Date", "Test-Path"
                            )
                            timestamp = (Get-Date).ToString('o')
                            port = $actualPort
                        } | ConvertTo-Json
                        
                        $buffer = [System.Text.Encoding]::UTF8.GetBytes($warningResponse)
                        $response.StatusCode = 403  # Forbidden for safety
                        $response.ContentLength64 = $buffer.Length
                        $response.OutputStream.Write($buffer, 0, $buffer.Length)
                        
                        Write-Host "🛡️  Blocked potentially unsafe command for security" -ForegroundColor Red
                    }
                    else {
                        Write-Host "⚡ Auto-executing safe command: $cmd" -ForegroundColor Yellow
                        
                        try {
                            $startTime = Get-Date
                            
                            # Use PowerShell's scriptblock approach for safer execution
                            $scriptBlock = [ScriptBlock]::Create($cmd)
                            $output = & $scriptBlock 2>&1
                        
                        $endTime = Get-Date
                        $duration = ($endTime - $startTime).TotalMilliseconds
                        
                        $cmdResponse = @{
                            command = $cmd
                            output = ($output | Out-String).Trim()
                            success = $true
                            duration_ms = [math]::Round($duration, 2)
                            timestamp = $startTime.ToString('o')
                            server_key = "[REDACTED]"
                            port = $actualPort
                        } | ConvertTo-Json -Depth 10
                        
                        $buffer = [System.Text.Encoding]::UTF8.GetBytes($cmdResponse)
                        $response.StatusCode = 200
                        $response.ContentLength64 = $buffer.Length
                        $response.OutputStream.Write($buffer, 0, $buffer.Length)
                        
                        Write-Host "✅ Command executed successfully ($duration ms)" -ForegroundColor Green
                        }
                        catch {
                            $errorResponse = @{
                                command = $cmd
                                error = $_.Exception.Message
                                success = $false
                                timestamp = (Get-Date).ToString('o')
                                port = $actualPort
                            } | ConvertTo-Json
                            
                            $buffer = [System.Text.Encoding]::UTF8.GetBytes($errorResponse)
                            $response.StatusCode = 500
                            $response.ContentLength64 = $buffer.Length
                            $response.OutputStream.Write($buffer, 0, $buffer.Length)
                            
                            Write-Host "❌ Command failed: $($_.Exception.Message)" -ForegroundColor Red
                        }
                    }
                }
                else {
                    # No command provided
                    $helpResponse = @{
                        message = "PowerShell HTTP Server"
                        usage = "Send GET request with ?key=$Key&cmd=<powershell-command>"
                        endpoints = @{
                            health = "/health?key=$Key"
                            execute = "/?key=$Key&cmd=<command>"
                            terminate = "/terminate?key=$Key"
                        }
                        timestamp = (Get-Date).ToString('o')
                    } | ConvertTo-Json
                    
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes($helpResponse)
                    $response.StatusCode = 200
                    $response.ContentLength64 = $buffer.Length
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                }
                
                $response.Close()
            }
            catch {
                Write-Host "❌ Request handling error: $($_.Exception.Message)" -ForegroundColor Red
                if ($response) {
                    $response.StatusCode = 500
                    $response.Close()
                }
            }
        }
    }
    catch {
        Write-Host "❌ Server error: $($_.Exception.Message)" -ForegroundColor Red
    }
    finally {
        if ($listener.IsListening) {
            $listener.Stop()
        }
        $listener.Dispose()
        Write-Host "🔴 PowerShell HTTP Server stopped" -ForegroundColor Red
    }
}

function Send-PowerShellHttpRequest {
    param(
        [string]$ServerUrl = 'http://localhost:8383',
        [string]$Key = '12345',
        [string]$Command = '',
        [switch]$Terminate,
        [switch]$Health
    )
    
    try {
        if ($Health) {
            $url = "$ServerUrl/health?key=$Key"
        }
        elseif ($Terminate) {
            $url = "$ServerUrl/terminate?key=$Key"
        }
        elseif ($Command) {
            $encodedCmd = [System.Web.HttpUtility]::UrlEncode($Command)
            $url = "$ServerUrl/?key=$Key&cmd=$encodedCmd"
        }
        else {
            $url = "$ServerUrl/?key=$Key"
        }
        
        Write-Host "📤 Sending request to: $url" -ForegroundColor Cyan
        
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 30
        Write-Host "📥 Response received:" -ForegroundColor Green
        $response | ConvertTo-Json -Depth 10 | Write-Host
        
        return $response
    }
    catch {
        Write-Host "❌ Request failed: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# Main execution logic
switch ($Mode.ToLower()) {
    'server' {
        Write-Host "🚀 Starting PowerShell HTTP Server..." -ForegroundColor Green
        Start-PowerShellHttpServer -StartPort $Port -Key $Key
    }
    
    'client' {
        Write-Host "📡 PowerShell HTTP Client Mode" -ForegroundColor Blue
        
        if ($Terminate) {
            Write-Host "🛑 Sending terminate request..." -ForegroundColor Yellow
            Send-PowerShellHttpRequest -ServerUrl $ServerUrl -Key $Key -Terminate
        }
        elseif ($Command) {
            Write-Host "⚡ Sending command: $Command" -ForegroundColor Yellow
            Send-PowerShellHttpRequest -ServerUrl $ServerUrl -Key $Key -Command $Command
        }
        else {
            Write-Host "💚 Sending health check..." -ForegroundColor Green
            Send-PowerShellHttpRequest -ServerUrl $ServerUrl -Key $Key -Health
        }
    }
    
    'test' {
        Write-Host "🧪 Testing PowerShell HTTP Server..." -ForegroundColor Magenta
        Write-Host "Using ServerUrl: $ServerUrl, Key: $Key" -ForegroundColor Cyan
        
        # Test health check
        Write-Host "`n1. Testing health endpoint..." -ForegroundColor Cyan
        Send-PowerShellHttpRequest -ServerUrl $ServerUrl -Key $Key -Health
        
        # Test simple command
        Write-Host "`n2. Testing simple command..." -ForegroundColor Cyan
        Send-PowerShellHttpRequest -ServerUrl $ServerUrl -Key $Key -Command "Get-Date"
        
        # Test complex command
        Write-Host "`n3. Testing complex command..." -ForegroundColor Cyan
        Send-PowerShellHttpRequest -ServerUrl $ServerUrl -Key $Key -Command "Get-Process | Select-Object -First 3 Name, CPU"
        
        Write-Host "`n🧪 Testing completed!" -ForegroundColor Magenta
    }
}

# Usage examples:
# .\ps-http-server.ps1 -Mode server                                           # Start server (auto-generates key, finds available port)
# .\ps-http-server.ps1 -Mode server -Key "mykey123" -Port 8383               # Start server with specific key and port
# .\ps-http-server.ps1 -Mode client -ServerUrl "http://localhost:8384" -Key "abc123" -Command "Get-Date"  # Send command
# .\ps-http-server.ps1 -Mode client -ServerUrl "http://localhost:8384" -Key "abc123" -Terminate          # Terminate server
# .\ps-http-server.ps1 -Mode test -ServerUrl "http://localhost:8384" -Key "abc123"                       # Run tests
