# PowerShell MCP Server Key Helper
# This script helps you find or manage your server key

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('find', 'test', 'generate')]
    [string]$Action = 'find',
    
    [Parameter(Mandatory=$false)]
    [string]$ServerUrl = 'http://localhost:8383',
    
    [Parameter(Mandatory=$false)]
    [string]$TestKey = ''
)

function Test-ServerKey {
    param(
        [string]$Url,
        [string]$Key
    )
    
    try {
        $healthUrl = "$Url/health?key=$Key"
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5 -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Generate-NewKey {
    $newKey = -join ((1..8) | ForEach-Object { [char]((65..90) + (97..122) + (48..57) | Get-Random) })
    return $newKey
}

Write-Host "=== PowerShell MCP Server Key Helper ===" -ForegroundColor Cyan
Write-Host ""

switch ($Action.ToLower()) {
    'find' {
        Write-Host "🔍 Searching for your server key..." -ForegroundColor Yellow
        Write-Host ""
        
        # Check if server is running
        Write-Host "1. Testing if server is running on $ServerUrl..." -ForegroundColor Cyan
        
        try {
            $testResponse = Invoke-WebRequest -Uri $ServerUrl -TimeoutSec 5 -ErrorAction Stop
            Write-Host "✅ Server is responding on $ServerUrl" -ForegroundColor Green
        }
        catch {
            Write-Host "❌ Server not responding on $ServerUrl" -ForegroundColor Red
            Write-Host "   Make sure your server is running with: .\ps-http-server.ps1 -Mode server" -ForegroundColor Yellow
            Write-Host ""
            return
        }
        
        Write-Host ""
        Write-Host "2. Looking for your key..." -ForegroundColor Cyan
        Write-Host ""
        Write-Host "🔍 Check these locations for your key:" -ForegroundColor Yellow
        Write-Host "   1. Terminal where you started the server (look for yellow text)" -ForegroundColor White
        Write-Host "   2. Look for lines like:" -ForegroundColor White
        Write-Host "      🔑 Auto-generated key: ABC12345" -ForegroundColor Yellow
        Write-Host "      🔑 Server key: ABC12345" -ForegroundColor Yellow
        Write-Host "      📋 Copy this for client use: -ServerUrl ... -Key ABC12345" -ForegroundColor Cyan
        Write-Host ""
        
        Write-Host "3. Common keys to try:" -ForegroundColor Cyan
        $commonKeys = @('12345', 'test', 'server', 'key123', 'abc123')
        foreach ($key in $commonKeys) {
            Write-Host "   Testing key '$key'... " -NoNewline -ForegroundColor White
            if (Test-ServerKey -Url $ServerUrl -Key $key) {
                Write-Host "✅ WORKS!" -ForegroundColor Green
                Write-Host ""
                Write-Host "🎉 Found your key: $key" -ForegroundColor Green
                Write-Host "📋 Use this command: .\ps-http-server.ps1 -Mode client -Command 'Get-Date' -Key '$key'" -ForegroundColor Cyan
                return
            } else {
                Write-Host "❌ No" -ForegroundColor Red
            }
        }
        
        Write-Host ""
        Write-Host "💡 If you can't find the key:" -ForegroundColor Yellow
        Write-Host "   1. Stop the current server (Ctrl+C)" -ForegroundColor White
        Write-Host "   2. Start a new one: .\ps-http-server.ps1 -Mode server" -ForegroundColor White
        Write-Host "   3. Copy the key from the startup output" -ForegroundColor White
        Write-Host ""
        Write-Host "   Or specify your own key:" -ForegroundColor White
        Write-Host "   .\ps-http-server.ps1 -Mode server -Key 'mykey123'" -ForegroundColor Cyan
    }
    
    'test' {
        if ([string]::IsNullOrEmpty($TestKey)) {
            Write-Host "❌ Please provide a key to test with -TestKey parameter" -ForegroundColor Red
            Write-Host "Example: .\key-helper.ps1 -Action test -TestKey 'ABC12345'" -ForegroundColor Cyan
            return
        }
        
        Write-Host "🧪 Testing key '$TestKey' on $ServerUrl..." -ForegroundColor Cyan
        
        if (Test-ServerKey -Url $ServerUrl -Key $TestKey) {
            Write-Host "✅ Key '$TestKey' works!" -ForegroundColor Green
            Write-Host ""
            Write-Host "📋 You can use these commands:" -ForegroundColor Cyan
            Write-Host "   .\ps-http-server.ps1 -Mode client -Command 'Get-Date' -Key '$TestKey'" -ForegroundColor White
            Write-Host "   .\quick-query.ps1 -Command 'Get-Date' -Key '$TestKey'" -ForegroundColor White
        } else {
            Write-Host "❌ Key '$TestKey' doesn't work" -ForegroundColor Red
            Write-Host "   Either the key is wrong or the server isn't running" -ForegroundColor Yellow
        }
    }
    
    'generate' {
        Write-Host "🎲 Generating a new random key..." -ForegroundColor Cyan
        $newKey = Generate-NewKey
        Write-Host ""
        Write-Host "✨ New key generated: $newKey" -ForegroundColor Green
        Write-Host ""
        Write-Host "📋 To use this key, start your server with:" -ForegroundColor Cyan
        Write-Host "   .\ps-http-server.ps1 -Mode server -Key '$newKey'" -ForegroundColor White
        Write-Host ""
        Write-Host "   Then query with:" -ForegroundColor Cyan
        Write-Host "   .\ps-http-server.ps1 -Mode client -Command 'Get-Date' -Key '$newKey'" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "=== Need More Help? ===" -ForegroundColor Cyan
Write-Host "Run: .\key-helper.ps1 -Action find      # Find existing key" -ForegroundColor White
Write-Host "Run: .\key-helper.ps1 -Action test -TestKey 'ABC123'  # Test a key" -ForegroundColor White
Write-Host "Run: .\key-helper.ps1 -Action generate  # Generate new key" -ForegroundColor White
