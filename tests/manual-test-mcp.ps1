# Manual MCP Server Testing Guide
# Start server and manually send JSON-RPC messages

Write-Host "🔧 Manual MCP Server Testing" -ForegroundColor Cyan
Write-Host "This will start the server and let you manually send requests" -ForegroundColor Yellow
Write-Host ""

# Start the server
Write-Host "Starting MCP server..." -ForegroundColor Green
$process = Start-Process -FilePath "node" -ArgumentList "dist\server.js", "--key", "testkey" `
    -PassThru -NoNewWindow -RedirectStandardInput -RedirectStandardOutput -RedirectStandardError

Write-Host "Server PID: $($process.Id)" -ForegroundColor Green
Write-Host ""
Write-Host "Server is now running. You can:"
Write-Host "1. Monitor logs in another terminal with: Get-Process -Id $($process.Id) | Select *" -ForegroundColor Yellow
Write-Host "2. Send JSON-RPC messages manually" -ForegroundColor Yellow
Write-Host ""

Write-Host "Example JSON-RPC messages to copy/paste:" -ForegroundColor Cyan
Write-Host ""

$initMsg = @{
    jsonrpc = "2.0"
    id = 1
    method = "initialize"
    params = @{
        protocolVersion = "2024-11-05"
        capabilities = @{ tools = @{} }
        clientInfo = @{ name = "manual-test"; version = "1.0.0" }
    }
} | ConvertTo-Json -Depth 10 -Compress

Write-Host "INITIALIZE:" -ForegroundColor Magenta
Write-Host $initMsg
Write-Host ""

$listMsg = @{
    jsonrpc = "2.0"
    id = 2
    method = "tools/list"
} | ConvertTo-Json -Depth 10 -Compress

Write-Host "LIST TOOLS:" -ForegroundColor Magenta
Write-Host $listMsg
Write-Host ""

$callMsg = @{
    jsonrpc = "2.0"
    id = 3
    method = "tools/call"
    params = @{
        name = "powershell-command"
        arguments = @{
            authKey = "testkey"
            command = "Get-Date"
        }
    }
} | ConvertTo-Json -Depth 10 -Compress

Write-Host "CALL TOOL:" -ForegroundColor Magenta
Write-Host $callMsg
Write-Host ""

Write-Host "To send a message:" -ForegroundColor Yellow
Write-Host "1. Copy one of the JSON messages above"
Write-Host "2. Echo it to the server: echo 'JSON_HERE' | & 'node' 'dist\server.js' '--key' 'testkey'"
Write-Host ""
Write-Host "Press Ctrl+C to stop this server when done."

# Keep the process alive
try {
    $process.WaitForExit()
}
catch {
    Write-Host "Server stopped."
}
finally {
    if (!$process.HasExited) {
        $process.Kill()
    }
}
