Param(
  [string]$OutDir = 'metrics'
)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$stamp = (Get-Date).ToString('yyyy-MM-dd-HH-mm-ss')
$files = Get-ChildItem -Recurse -File -Include *.ts,*.ps1,*.mjs | Where-Object { $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\dist\\" }
$totalLines = 0
$details = @()
foreach($f in $files){
  $lines = (Get-Content $f.FullName).Count
  $totalLines += $lines
  $details += [pscustomobject]@{ path=$f.FullName; lines=$lines }
}
$tsFiles = $files | Where-Object { $_.Extension -eq '.ts' }
$psFiles = $files | Where-Object { $_.Extension -eq '.ps1' }
$mjsFiles = $files | Where-Object { $_.Extension -eq '.mjs' }
$result = [pscustomobject]@{
  timestamp = (Get-Date).ToString('o')
  totalLines = $totalLines
  counts = [pscustomobject]@{ ts=$tsFiles.Count; ps1=$psFiles.Count; mjs=$mjsFiles.Count }
  files = $details
}
$result | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $OutDir "codebase-stats-$stamp.json")
Write-Host "Codebase stats collected."
