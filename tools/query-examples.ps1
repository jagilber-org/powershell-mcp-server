# PowerShell MCP Server Query Examples
# These examples show how to query your PowerShell MCP server from command line

# =============================================================================
# STEP 1: Start your server first
# =============================================================================
Write-Host "First, start your server:" -ForegroundColor Yellow
Write-Host 'PS> .\ps-http-server.ps1 -Mode server' -ForegroundColor Cyan
Write-Host "Server will display the key and port (e.g., Key: ABC12345, Port: 8383)" -ForegroundColor Gray
Write-Host ""

# =============================================================================
# Method 1: Direct PowerShell Commands with Invoke-RestMethod
# =============================================================================
Write-Host "=== Method 1: Direct PowerShell Commands ===" -ForegroundColor Green

$serverUrl = "http://localhost:8383"
$key = "YOUR_SERVER_KEY_HERE"  # Replace with actual key from server output

Write-Host "Replace YOUR_SERVER_KEY_HERE with your actual server key!" -ForegroundColor Yellow
Write-Host ""

# Health check
Write-Host "1. Health Check:" -ForegroundColor Cyan
$healthUrl = "$serverUrl/health?key=$key"
Write-Host "   Command: Invoke-RestMethod -Uri '$healthUrl'" -ForegroundColor White
Write-Host '   Quick:   irm "http://localhost:8383/health?key=YOUR_KEY"' -ForegroundColor Gray
Write-Host ""

# Execute PowerShell commands
Write-Host "2. Execute Commands:" -ForegroundColor Cyan
$cmdExamples = @(
    "Get-Date",
    "Get-Process | Select-Object -First 5 Name, CPU",
    "Get-Service | Where-Object {`$_.Status -eq 'Running'} | Select-Object -First 3",
    "Test-Path C:\Windows",
    "Get-ChildItem C:\ | Select-Object Name, LastWriteTime -First 5"
)

foreach ($cmd in $cmdExamples) {
    $encodedCmd = [System.Web.HttpUtility]::UrlEncode($cmd)
    $cmdUrl = "$serverUrl/?key=$key&cmd=$encodedCmd"
    Write-Host "   Command: '$cmd'" -ForegroundColor White
    Write-Host "   URL:     Invoke-RestMethod -Uri '$cmdUrl'" -ForegroundColor Gray
    Write-Host "   Quick:   irm `"$serverUrl/?key=$key&cmd=$([System.Web.HttpUtility]::UrlEncode($cmd))`"" -ForegroundColor Gray
    Write-Host ""
}

# Terminate server
Write-Host "3. Terminate Server:" -ForegroundColor Cyan
$terminateUrl = "$serverUrl/terminate?key=$key"
Write-Host "   Command: Invoke-RestMethod -Uri '$terminateUrl'" -ForegroundColor White
Write-Host '   Quick:   irm "http://localhost:8383/terminate?key=YOUR_KEY"' -ForegroundColor Gray
Write-Host ""

# =============================================================================
# Method 2: Using curl (if available)
# =============================================================================
Write-Host "=== Method 2: Using curl ===" -ForegroundColor Green
Write-Host "1. Health check:" -ForegroundColor Cyan
Write-Host '   curl "http://localhost:8383/health?key=YOUR_KEY"' -ForegroundColor White
Write-Host ""

Write-Host "2. Execute command:" -ForegroundColor Cyan
Write-Host '   curl "http://localhost:8383/?key=YOUR_KEY&cmd=Get-Date"' -ForegroundColor White
Write-Host '   curl "http://localhost:8383/?key=YOUR_KEY&cmd=Get-Process"' -ForegroundColor White
Write-Host ""

# =============================================================================
# Method 3: Using the built-in client mode
# =============================================================================
Write-Host "=== Method 3: Built-in Client Mode (Easiest) ===" -ForegroundColor Green
Write-Host "Your script has a built-in client mode!" -ForegroundColor Yellow
Write-Host ""

Write-Host "1. Health check:" -ForegroundColor Cyan
Write-Host '   .\ps-http-server.ps1 -Mode client -ServerUrl "http://localhost:8383" -Key "YOUR_KEY"' -ForegroundColor White
Write-Host ""

Write-Host "2. Execute commands:" -ForegroundColor Cyan
Write-Host '   .\ps-http-server.ps1 -Mode client -ServerUrl "http://localhost:8383" -Key "YOUR_KEY" -Command "Get-Date"' -ForegroundColor White
Write-Host '   .\ps-http-server.ps1 -Mode client -ServerUrl "http://localhost:8383" -Key "YOUR_KEY" -Command "Get-Process | Select -First 5"' -ForegroundColor White
Write-Host ""

Write-Host "3. Terminate server:" -ForegroundColor Cyan
Write-Host '   .\ps-http-server.ps1 -Mode client -ServerUrl "http://localhost:8383" -Key "YOUR_KEY" -Terminate' -ForegroundColor White
Write-Host ""

Write-Host "4. Run all tests:" -ForegroundColor Cyan
Write-Host '   .\ps-http-server.ps1 -Mode test -ServerUrl "http://localhost:8383" -Key "YOUR_KEY"' -ForegroundColor White
Write-Host ""

# =============================================================================
# Method 4: Browser (for simple testing)
# =============================================================================
Write-Host "=== Method 4: Web Browser ===" -ForegroundColor Green
Write-Host "You can also test in a web browser by visiting these URLs:" -ForegroundColor Yellow
Write-Host "1. Health: http://localhost:8383/health?key=YOUR_KEY" -ForegroundColor White
Write-Host "2. Command: http://localhost:8383/?key=YOUR_KEY&cmd=Get-Date" -ForegroundColor White
Write-Host ""

Write-Host "=== Security Notes ===" -ForegroundColor Red
Write-Host "🔒 Your server has multiple execution methods:" -ForegroundColor Yellow
Write-Host "   - RestrictedRunspace (most secure, read-only commands only)" -ForegroundColor Gray
Write-Host "   - Job (default, good isolation with timeout)" -ForegroundColor Gray  
Write-Host "   - ScriptBlock (fastest, less secure)" -ForegroundColor Gray
Write-Host ""
Write-Host "🛡️  The server automatically blocks potentially unsafe commands" -ForegroundColor Yellow
Write-Host "✅ Safe commands (Get-, Test-, Show-) are allowed automatically" -ForegroundColor Green
Write-Host "❌ Unsafe commands (Remove-, Stop-, Install-) require confirmed:true" -ForegroundColor Red
