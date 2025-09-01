# Quick test to see if MCP server can receive basic JSON
# This won't get full responses but will show server logs

$testMessage = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"echo-test","version":"1.0.0"}}}'

Write-Host "🔍 Quick MCP Server Test" -ForegroundColor Cyan
Write-Host "Sending initialize message via echo..." -ForegroundColor Yellow
Write-Host ""

Write-Host "Message:" -ForegroundColor Green
Write-Host $testMessage
Write-Host ""

Write-Host "Server response:" -ForegroundColor Magenta
echo $testMessage | node dist\server.js --key testkey

Write-Host ""
Write-Host "✅ If you see server logs above, stdio transport is working!" -ForegroundColor Green
