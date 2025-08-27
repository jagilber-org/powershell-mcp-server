param(
  [int]$TimeoutSeconds = 5
)
$ErrorActionPreference = 'Stop'
$env:START_MODE = 'health'
$node = Get-Command node -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
$tmpRoot = [IO.Path]::GetTempPath()
$stdoutPath = Join-Path $tmpRoot ("psmcp-health-out-"+[guid]::NewGuid().ToString()+".log")
$stderrPath = Join-Path $tmpRoot ("psmcp-health-err-"+[guid]::NewGuid().ToString()+".log")
New-Item -Path $stdoutPath -ItemType File -Force | Out-Null
New-Item -Path $stderrPath -ItemType File -Force | Out-Null
$proc = Start-Process -FilePath $node -ArgumentList 'dist/index.js' -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
$completed = $proc.WaitForExit($TimeoutSeconds * 1000)
if(-not $completed){
  try { $proc.Kill() } catch{}
  Write-Output (@{ status = 'timeout'; timeoutSeconds = $TimeoutSeconds } | ConvertTo-Json -Compress)
  exit 1
}
try {
  $out = (Get-Content -Raw -Path $stdoutPath -ErrorAction SilentlyContinue).Trim()
  if(-not $out){
  $err = Get-Content -Raw -Path $stderrPath -ErrorAction SilentlyContinue
    Write-Output (@{ status='error'; exitCode=$proc.ExitCode; stderr=$err } | ConvertTo-Json -Compress)
    exit 1
  }
  # Validate JSON
  try { $json = $out | ConvertFrom-Json -ErrorAction Stop } catch { Write-Output (@{ status='invalid-json'; raw=$out } | ConvertTo-Json -Compress); exit 1 }
  $json | Add-Member -NotePropertyName status -NotePropertyValue 'ok' -Force
  $json | ConvertTo-Json -Compress
  exit 0
} catch {
  Write-Output (@{ status='exception'; message=$_.Exception.Message } | ConvertTo-Json -Compress)
  exit 1
}
