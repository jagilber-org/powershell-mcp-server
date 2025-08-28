param(
  [string]$Command = 'while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }',
  [int]$TimeoutSec = 1,
  [int]$WaitAfterMs = 200,
  [switch]$VerboseJson
)

$ErrorActionPreference = 'Stop'

function Write-Info($m){ Write-Host "[hang-validate] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[hang-validate] $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[hang-validate] $m" -ForegroundColor Red }

# Ensure build exists
$serverJs = Join-Path $PSScriptRoot '..' 'dist' 'server.js'
if(-not (Test-Path $serverJs)){
  Write-Info 'dist/server.js not found -> running npm run build'
  pushd (Join-Path $PSScriptRoot '..')
  npm run build | Out-Null
  popd
  if(-not (Test-Path $serverJs)){ throw 'Build failed: dist/server.js still missing.' }
}

$node = (Get-Command node -ErrorAction Stop).Source
Write-Info "Starting server (timeoutSec=$TimeoutSec)"
$proc = Start-Process $node -ArgumentList @($serverJs) -RedirectStandardInput pipe -RedirectStandardOutput pipe -RedirectStandardError pipe -PassThru -WindowStyle Hidden

$start = Get-Date
$reqId = 'hang1'
$jsonReq = @{ jsonrpc='2.0'; id=$reqId; method='callTool'; params=@{ name='run-powershell'; arguments=@{ command=$Command; confirmed=$true; timeout=$TimeoutSec } } } | ConvertTo-Json -Compress
$proc.StandardInput.WriteLine($jsonReq)

$deadline = (Get-Date).AddSeconds($TimeoutSec + 8)
$response = $null
while((Get-Date) -lt $deadline){
  if($proc.HasExited){ Write-Warn 'Server exited early.'; break }
  if($proc.StandardOutput.Peek() -ge 0){
    $line = $proc.StandardOutput.ReadLine()
    if(-not [string]::IsNullOrWhiteSpace($line)){
      try { $obj = $line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
      if($obj.id -eq $reqId){ $response = $obj; break }
    }
  } else { Start-Sleep -Milliseconds 60 }
}

Start-Sleep -Milliseconds $WaitAfterMs
if(-not $proc.HasExited){ $proc.Kill() | Out-Null }

if(-not $response){ Write-Err 'No response captured (timeout mechanism may have failed).'; exit 2 }

$structured = $response.result.structuredContent
if(-not $structured){
  try { $structured = ($response.result.content[0].text | ConvertFrom-Json -ErrorAction Stop) } catch {}
}

if($VerboseJson){
  Write-Host ($response | ConvertTo-Json -Depth 8) -ForegroundColor Gray
}

$elapsedMs = [int](([DateTime]::UtcNow - $start.ToUniversalTime()).TotalMilliseconds)
$configured = $structured.configuredTimeoutMs
if(-not $configured){ $configured = $TimeoutSec * 1000 }

$result = [pscustomobject]@{
  commandSample = ($Command.Substring(0,[Math]::Min(60,$Command.Length)))
  elapsedMs = $elapsedMs
  configuredTimeoutMs = $configured
  elapsedPct = [math]::Round(($elapsedMs / $configured)*100,1)
  timedOut = $structured.timedOut
  exitCode = $structured.exitCode
  success = $structured.success
  internalSelfDestruct = $structured.internalSelfDestruct
  watchdogTriggered = $structured.watchdogTriggered
  warnings = ($structured.warnings -join '; ')
}

$result | Format-List

# Basic assertions mirroring stricter test semantics
$errors = @()
if(-not ($result.timedOut -or $result.exitCode -eq 124)){ $errors += 'Did not observe timedOut or exitCode 124' }
if($result.success){ $errors += 'Result reports success=true for a hang' }
if($result.elapsedMs -lt ($result.configuredTimeoutMs * 0.8)){ $errors += 'Elapsed runtime <80% of configured timeout (ended too early)' }

if($errors.Count){
  Write-Err ('FAIL: ' + ($errors -join '; '))
  exit 1
} else {
  Write-Info 'PASS: Hang semantics validated.'
}
