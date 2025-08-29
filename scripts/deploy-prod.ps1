<#
 .SYNOPSIS
  Builds and deploys the PowerShell MCP server to a production directory (default: C:\mcp\powershell-mcp-server).

 .DESCRIPTION
  Performs a safe, repeatable deployment:
    1. (Optional) Runs tests (jest) unless -SkipTests specified.
    2. Runs TypeScript build (npm run build:only).
    3. Stages deployment artifacts into a temporary folder.
    4. Creates a timestamped backup of the current production directory (unless -NoBackup).
    5. Syncs staged artifacts to the destination using RoboCopy /MIR.
    6. Runs npm clean install in destination with dev dependencies omitted by default (override with -IncludeDev or -NoInstall).
    7. Writes a deployment manifest (deploy-manifest.json) including version, git commit, timestamp, and file hash list.

  Idempotent: re-running with same commit simply refreshes artifacts.

 .PARAMETER Destination
  Target production directory. Default C:\mcp\powershell-mcp-server

 .PARAMETER SkipTests
  Skip running the jest test suite prior to build.

 .PARAMETER NoInstall
  Skip running npm ci in the destination (assumes existing node_modules kept).

 .PARAMETER IncludeDev
  Include devDependencies during npm ci (omit by default for lean prod footprint).

 .PARAMETER NoBackup
  Do not create a backup of the existing destination directory prior to overwrite.

 .PARAMETER DryRun
  Show planned actions without performing copy or installation.

 .PARAMETER VerboseHashes
  Include per-file SHA256 hashes in deployment manifest (slower on large trees).

 .EXAMPLE
  ./scripts/deploy-prod.ps1

 .EXAMPLE
  ./scripts/deploy-prod.ps1 -Destination C:\mcp\ps-mcp -SkipTests -IncludeDev

 .NOTES
  Requires: Node.js, npm, PowerShell 7+; RoboCopy (built-in on Windows).
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Destination = 'C:\mcp\powershell-mcp-server',
  [switch]$SkipTests,
  [switch]$NoInstall,
  [switch]$IncludeDev,
  [switch]$NoBackup,
  [switch]$DryRun,
  [switch]$VerboseHashes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info($Msg){ Write-Host "[deploy] $Msg" -ForegroundColor Cyan }
function Write-Warn($Msg){ Write-Host "[deploy] WARN: $Msg" -ForegroundColor Yellow }
function Write-Err($Msg){ Write-Host "[deploy] ERROR: $Msg" -ForegroundColor Red }

$script:StartTime = Get-Date

# Resolve repo root (parent of scripts folder)
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path package.json)) { Write-Err 'package.json not found. Run from repo root.'; exit 1 }

# Capture git metadata (best effort)
function Get-GitMeta {
  $meta = [ordered]@{}
  foreach($k in 'rev-parse HEAD','rev-parse --abbrev-ref HEAD','status --porcelain'){
    try {
      $cmd,$args = 'git', ($k -split ' ')
      $out = & $cmd $args 2>$null | Out-String
      $meta[$k] = $out.Trim()
    } catch {}
  }
  return $meta
}
$gitMeta = Get-GitMeta

Write-Info "Repo root: $repoRoot"
Write-Info "Destination: $Destination"
if($gitMeta.'rev-parse HEAD'){ Write-Info "Commit: $($gitMeta.'rev-parse HEAD')" }

if(-not $SkipTests){
  Write-Info 'Running test suite (jest)...'
  if($DryRun){ Write-Info 'DryRun: skipping jest execution.' }
  else {
    npm run test:jest --silent | Write-Host
  }
} else { Write-Warn 'Skipping tests.' }

Write-Info 'Building (TypeScript)...'
if($DryRun){ Write-Info 'DryRun: skipping build.' } else { npm run build:only | Write-Host }

if(-not (Test-Path dist)) { Write-Err 'dist folder missing after build.'; exit 1 }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Join-Path $env:TEMP ("psmcp_deploy_" + $timestamp)
Write-Info "Staging: $staging"
if(-not $DryRun){ New-Item -ItemType Directory -Path $staging | Out-Null }

# Artifact selection
$artifactList = @(
  'dist',
  'package.json','package-lock.json','README.md','mcp-config.json','enterprise-config.json',
  'instructions','docs'
  # add other runtime-needed assets here
)

foreach($item in $artifactList){
  if(Test-Path $item){
    Write-Info "Stage $item"
    if(-not $DryRun){
      if((Get-Item $item).PSIsContainer){
        robocopy $item (Join-Path $staging $item) /E /NFL /NDL /NJH /NJS | Out-Null
      } else {
        $destFileDir = Split-Path (Join-Path $staging $item) -Parent
        if(-not (Test-Path $destFileDir)){ New-Item -ItemType Directory -Path $destFileDir | Out-Null }
        Copy-Item $item -Destination (Join-Path $staging $item) -Force
      }
    }
  } else {
    Write-Warn "Missing optional artifact: $item"
  }
}

# Compute hashes (optional)
$fileHashes = @()
if($VerboseHashes){
  if(-not $DryRun){
    Get-ChildItem -Path $staging -Recurse -File | ForEach-Object {
      try {
        $h = Get-FileHash -Algorithm SHA256 -Path $_.FullName
        $fileHashes += [pscustomobject]@{ Path = $_.FullName.Substring($staging.Length+1); Sha256 = $h.Hash }
      } catch { Write-Warn "Hash failed: $($_.FullName) $_" }
    }
  }
}

# Backup existing
if(Test-Path $Destination){
  if(-not $NoBackup){
    $backupRoot = Join-Path ([IO.Path]::GetDirectoryName($Destination)) ((Split-Path $Destination -Leaf) + '_backup_' + $timestamp)
    Write-Info "Backing up existing deployment to $backupRoot"
    if(-not $DryRun){ robocopy $Destination $backupRoot /MIR /NFL /NDL /NJH /NJS | Out-Null }
  } else {
    Write-Warn 'NoBackup specified; existing contents will be overwritten.'
  }
}

if(-not $DryRun){
  if(-not (Test-Path $Destination)){ New-Item -ItemType Directory -Path $Destination | Out-Null }
  Write-Info 'Sync staging -> destination'
  robocopy $staging $Destination /MIR /NFL /NDL /NJH /NJS | Out-Null
} else {
  Write-Info 'DryRun: skipping sync.'
}

if(-not $NoInstall){
  Write-Info "Installing production node_modules (omit dev: $(-not $IncludeDev))"
  if(-not $DryRun){
    Push-Location $Destination
    if(Test-Path node_modules){ Write-Info 'Removing existing node_modules'; try { Remove-Item -Recurse -Force node_modules } catch { Write-Warn "Failed to remove node_modules: $_" } }
    $omit = $IncludeDev ? '' : '--omit=dev'
    npm ci $omit | Write-Host
    Pop-Location
  }
} else { Write-Warn 'Skipping npm install (NoInstall).' }

# Deployment manifest (refactored to avoid parser issues on some hosts)
$pkgJson = $null
try { $pkgJson = Get-Content package.json -Raw | ConvertFrom-Json } catch { }
$pkgVersion = if($pkgJson){ $pkgJson.version } else { $null }
$manifest = [ordered]@{}
$manifest.deployedAt = (Get-Date).ToString('o')
$manifest.sourceRepo = (Get-Item $repoRoot).FullName
$manifest.destination = $Destination
$manifest.commit = $gitMeta.'rev-parse HEAD'
$manifest.branch = $gitMeta.'rev-parse --abbrev-ref HEAD'
$manifest.dirty = [bool]($gitMeta.'status --porcelain')
$manifest.version = $pkgVersion
$manifest.includeDevDependencies = [bool]$IncludeDev
$manifest.testsSkipped = [bool]$SkipTests
$manifest.noInstall = [bool]$NoInstall
$manifest.fileHashCount = $fileHashes.Count
$manifest.durationSeconds = [int]((Get-Date) - $script:StartTime).TotalSeconds
if($VerboseHashes){ $manifest.fileHashes = $fileHashes }

if(-not $DryRun){
  $manifestPath = Join-Path $Destination 'deploy-manifest.json'
  $manifest | ConvertTo-Json -Depth 6 | Out-File -Encoding UTF8 $manifestPath
  Write-Info "Wrote manifest: $manifestPath"
  Write-Info "Deployment complete in $($manifest.durationSeconds)s"
} else {
  Write-Info 'DryRun manifest:'
  $manifest | ConvertTo-Json -Depth 4 | Write-Host
}

Write-Info 'Next: Start server with `node dist/index.js` (or enterprise/server variant).'
