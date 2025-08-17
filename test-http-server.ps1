# Test script for PowerShell MCP Server HTTP functionality
# This tests the embedded HTTP server on port 8384

$port = 8384
$key = "mcp-powershell-12345"

Write-Host "Testing PowerShell MCP Server HTTP endpoints..." -ForegroundColor Green

# Test 1: Health check
try {
    Write-Host "`nTesting health endpoint..." -ForegroundColor Cyan
    $healthResponse = Invoke-RestMethod -Uri "http://localhost:$port/health" -Method Get
    Write-Host "Health check successful:" -ForegroundColor Green
    $healthResponse | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: PowerShell command execution
try {
    Write-Host "`nTesting PowerShell command execution..." -ForegroundColor Cyan
    $cmd = "Get-Date"
    $encodedCmd = [System.Web.HttpUtility]::UrlEncode($cmd)
    $cmdResponse = Invoke-RestMethod -Uri "http://localhost:$port/ps?key=$key&cmd=$encodedCmd" -Method Get
    Write-Host "Command execution successful:" -ForegroundColor Green
    $cmdResponse | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Command execution failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Complex PowerShell command
try {
    Write-Host "`nTesting complex PowerShell command..." -ForegroundColor Cyan
    $cmd = "Get-Process | Select-Object -First 5 Name, CPU"
    $encodedCmd = [System.Web.HttpUtility]::UrlEncode($cmd)
    $complexResponse = Invoke-RestMethod -Uri "http://localhost:$port/ps?key=$key&cmd=$encodedCmd" -Method Get
    Write-Host "Complex command execution successful:" -ForegroundColor Green
    $complexResponse | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Complex command execution failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nHTTP server testing completed!" -ForegroundColor Green
