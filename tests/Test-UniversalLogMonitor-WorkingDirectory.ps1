# Test-UniversalLogMonitor-WorkingDirectory.ps1
# Validates that the -WorkingDirectory parameter starts monitoring successfully.

param(
	[int]$TimeoutSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-FakeWorkspace {
	$root = Join-Path $env:TEMP ("mcp-test-" + [guid]::NewGuid())
	New-Item -ItemType Directory -Path $root -Force | Out-Null
	New-Item -ItemType Directory -Path (Join-Path $root 'logs') -Force | Out-Null
	$log = Join-Path $root ("logs/powershell-mcp-audit-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')
	$seed = '[AUDIT]{"timestamp":"' + (Get-Date).ToString('o') + '","level":"INFO","message":"seed"}'
	$seed | Out-File -FilePath $log -Encoding UTF8
	return [pscustomobject]@{ Root=$root; Log=$log }
}

$workspace = New-FakeWorkspace

$monitorScript = Resolve-Path (Join-Path $PSScriptRoot '..' 'UniversalLogMonitor.ps1')
if (-not (Test-Path $monitorScript)) { Write-Host 'FAIL: UniversalLogMonitor.ps1 not found.' -ForegroundColor Red; exit 1 }

$proc = Start-Process pwsh -ArgumentList @('-ExecutionPolicy','Bypass','-File', $monitorScript, '-NoNewWindow','-WorkingDirectory', $workspace.Root,'-HideJson') -PassThru -WindowStyle Hidden

Start-Sleep -Seconds $TimeoutSeconds
$alive = -not $proc.HasExited

try { if ($alive) { $proc | Stop-Process -Force } } catch {}
try { Remove-Item -Recurse -Force $workspace.Root -ErrorAction SilentlyContinue } catch {}

if ($alive) {
	Write-Host 'PASS: Monitor launched with -WorkingDirectory and remained running.' -ForegroundColor Green
	exit 0
} else {
	Write-Host 'FAIL: Monitor process exited prematurely.' -ForegroundColor Red
	exit 1
}

