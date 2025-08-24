<#!
.SYNOPSIS
 Enumerate an external MCP server workspace (e.g. obfuscate-mcp-server) to assist in aligning test setup.
.DESCRIPTION
 Scans a target repository path (default C:\github\jagilber\obfuscate-mcp-server) and collects metadata about
 test-related files (.mjs, .ps1, .json). Produces rich summary including counts by extension and folder, newest/oldest
 modification times, and optional JSON output suitable for automation.
.PARAMETER Path
 Root path of the external repository to enumerate.
.PARAMETER Include
 Array of file extensions to include (default: .mjs,.ps1,.json)
.PARAMETER OutputJson
 When supplied, emits a single JSON object to stdout instead of formatted table output.
.EXAMPLE
 ./tools/enumerate-external-tests.ps1 -Path C:\github\jagilber\obfuscate-mcp-server -OutputJson > external-tests.json
.EXAMPLE
 ./tools/enumerate-external-tests.ps1 -OutputJson | jq '.summary'
#>
[CmdletBinding()]
param(
  [string]$Path = 'C:\github\jagilber\obfuscate-mcp-server',
  [string[]]$Include = @('.mjs','.ps1','.json'),
  [switch]$OutputJson,
  [int]$MaxSampleLineLength = 160,
  [int]$MaxContentPreviewLines = 3,
  [switch]$HashContent
)

function New-Hash {
  param([string]$File)
  try { (Get-FileHash -Path $File -Algorithm SHA256).Hash } catch { $null }
}

if(-not (Test-Path $Path)){
  $err = [pscustomobject]@{ error = 'PathNotFound'; target = $Path }
  if($OutputJson){ $err | ConvertTo-Json -Depth 6; exit 0 } else { Write-Warning "Path not found: $Path"; return }
}

$testRootCandidates = @('tests','test','spec','__tests__') | ForEach-Object { Join-Path $Path $_ } | Where-Object { Test-Path $_ }
if(-not $testRootCandidates){ $testRootCandidates = @($Path) }

$items = @()
foreach($root in $testRootCandidates){
  Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $Include -contains $_.Extension.ToLower() } | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length).TrimStart('\\','/')
    $preview = @()
    if($MaxContentPreviewLines -gt 0){
      try { $i=0; foreach($line in Get-Content -Path $_.FullName -TotalCount $MaxContentPreviewLines){ $i++; if($line.Length -gt $MaxSampleLineLength){ $preview += ($line.Substring(0,$MaxSampleLineLength)+'…') } else { $preview += $line } } } catch {}
    }
    $hash = if($HashContent){ New-Hash -File $_.FullName } else { $null }
    $items += [pscustomobject]@{
      Name = $_.Name
      RelativePath = (Join-Path (Split-Path -Leaf $root) $rel)
      Extension = $_.Extension.ToLower()
      SizeKB = [math]::Round($_.Length / 1KB,2)
      LastWriteTime = $_.LastWriteTime
      Preview = if($preview){ $preview -join '\n' } else { $null }
      Hash = $hash
    }
  }
}

$byExt = $items | Group-Object Extension | Sort-Object Count -Descending | ForEach-Object { [pscustomobject]@{ Extension=$_.Name; Count=$_.Count } }
$byFolder = $items | ForEach-Object { ($_ .RelativePath -split '[\\/]')[0] } | Group-Object | Sort-Object Count -Descending | ForEach-Object { [pscustomobject]@{ Folder=$_.Name; Count=$_.Count } }

$summary = [pscustomobject]@{
  target = $Path
  detectedTestRoots = $testRootCandidates
  totalFiles = $items.Count
  newest = ($items | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
  oldest = ($items | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime
  byExtension = $byExt
  byFolder = $byFolder
}

if($OutputJson){
  [pscustomobject]@{ summary = $summary; items = $items } | ConvertTo-Json -Depth 6
} else {
  Write-Host "Enumerated $($items.Count) test-related files in $Path" -ForegroundColor Cyan
  Write-Host "Test Roots:`n  $($testRootCandidates -join "`n  ")" -ForegroundColor DarkCyan
  Write-Host "By Extension:" -ForegroundColor Yellow
  $byExt | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "By Folder:" -ForegroundColor Yellow
  $byFolder | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "Newest: $($summary.newest)  Oldest: $($summary.oldest)" -ForegroundColor Gray
  Write-Host "Sample Items:" -ForegroundColor Yellow
  $items | Select-Object -First 10 | Format-Table Name,RelativePath,Extension,SizeKB,LastWriteTime | Out-String | Write-Host
  Write-Host "(Use -OutputJson for machine-readable output)" -ForegroundColor DarkGray
}
