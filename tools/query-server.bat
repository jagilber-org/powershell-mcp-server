@echo off
REM PowerShell MCP Server Query Batch Script
REM Usage: query-server.bat "Get-Date" "YOUR_KEY" [SERVER_URL]

setlocal enabledelayedexpansion

set COMMAND=%~1
set KEY=%~2
set SERVER_URL=%~3

if "%SERVER_URL%"=="" set SERVER_URL=http://localhost:8383

if "%COMMAND%"=="" (
    echo.
    echo *** PowerShell MCP Server Query Tool ***
    echo.
    echo Usage: query-server.bat "COMMAND" "KEY" [SERVER_URL]
    echo.
    echo Examples:
    echo   query-server.bat "Get-Date" "ABC12345"
    echo   query-server.bat "Get-Process" "ABC12345" "http://localhost:8384"
    echo   query-server.bat "health" "ABC12345"
    echo   query-server.bat "terminate" "ABC12345"
    echo.
    exit /b 1
)

if "%KEY%"=="" (
    echo Error: Server key is required
    echo Get the key from your server startup output
    exit /b 1
)

echo Querying PowerShell MCP Server...
echo Command: %COMMAND%
echo Server: %SERVER_URL%
echo.

REM Handle special commands
if /i "%COMMAND%"=="health" (
    set URL=%SERVER_URL%/health?key=%KEY%
    echo Health check URL: !URL!
) else if /i "%COMMAND%"=="terminate" (
    set URL=%SERVER_URL%/terminate?key=%KEY%
    echo Terminate URL: !URL!
) else (
    REM URL encode the command (basic encoding)
    set "ENCODED_CMD=%COMMAND: =%%20%"
    set "ENCODED_CMD=!ENCODED_CMD:|=%%7C!"
    set "ENCODED_CMD=!ENCODED_CMD:&=%%26!"
    set URL=%SERVER_URL%/?key=%KEY%^&cmd=!ENCODED_CMD!
    echo Execute URL: !URL!
)

echo.
echo Sending request...

REM Use PowerShell to make the HTTP request
powershell -Command "try { $response = Invoke-RestMethod -Uri '%URL%' -TimeoutSec 30; Write-Host 'Response:' -ForegroundColor Green; if ($response.output) { Write-Host $response.output } elseif ($response.message) { Write-Host $response.message } elseif ($response.status) { Write-Host $response.status } else { $response | ConvertTo-Json } } catch { Write-Host 'Error: ' -ForegroundColor Red -NoNewline; Write-Host $_.Exception.Message }"

echo.
echo Done.
