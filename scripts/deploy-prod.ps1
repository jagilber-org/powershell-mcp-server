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
  [switch]$VerboseHashes,
  [switch]$NoPreserveLearned,
  [switch]$HealthCheck,
  [int]$HealthPort = 9105,
  [int]$HealthTimeoutSec = 15,
  [ValidateSet('server','mcpServer')] [string]$Entrypoint = 'server',
  [switch]$VerifyDashboard
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

# Preserve existing learned-safe.json (path captured before any sync) unless user disables
$existingLearnedPath = Join-Path $Destination 'learned-safe.json'
$restoreLearned = (Test-Path $existingLearnedPath) -and (-not $NoPreserveLearned)
if($restoreLearned){ Write-Info 'Will restore existing learned-safe.json after sync (use -NoPreserveLearned to disable).' }

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
  'package.json','package-lock.json','README.md','config',
  'data/learned-safe.json',
  'instructions','docs'
  # add other runtime-needed assets here
)

# Ensure data/learned-safe.json exists so verification script passes (create minimal placeholder if absent)
if(-not (Test-Path 'data/learned-safe.json')){
  Write-Warn 'data/learned-safe.json missing; creating placeholder.'
  if(-not (Test-Path 'data')){ New-Item -ItemType Directory -Path 'data' | Out-Null }
  '{"version":1,"approved":[]}' | Out-File -Encoding utf8 'data/learned-safe.json'
}

# Capture existing dashboard file hash (if present) before sync for comparison
$preDashHash = $null
if($VerifyDashboard -and (Test-Path (Join-Path $Destination 'dist/metrics/httpServer.js'))){
  try { $preDashHash = (Get-FileHash (Join-Path $Destination 'dist/metrics/httpServer.js') -Algorithm SHA256).Hash } catch { Write-Warn "Could not hash existing dashboard file: $_" }
}

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

# Post-sync dashboard verification
if($VerifyDashboard){
  $dashStage = Join-Path $staging 'dist/metrics/httpServer.js'
  $dashDest  = Join-Path $Destination 'dist/metrics/httpServer.js'
  if(Test-Path $dashStage){
    try {
      $stageHash = (Test-Path $dashStage) ? (Get-FileHash $dashStage -Algorithm SHA256).Hash : $null
      $destHash  = (Test-Path $dashDest)  ? (Get-FileHash $dashDest  -Algorithm SHA256).Hash : $null
      Write-Info "Dashboard file (staged) exists: $($stageHash ? 'yes':'no')"
      if(-not $DryRun){
        Write-Info "Dashboard file (destination) exists: $([bool]$destHash)"
        if($preDashHash){ Write-Info "Previous dashboard hash: $preDashHash" }
        if($stageHash){ Write-Info "Staged dashboard hash:   $stageHash" }
        if($destHash){ Write-Info  "Deployed dashboard hash: $destHash" }
        if($stageHash -and $destHash -and $stageHash -ne $destHash){ Write-Warn 'Deployed dashboard hash differs from staged (unexpected after MIR).'; }
        elseif($stageHash -and $destHash -and $stageHash -eq $destHash){ Write-Info 'Dashboard file hash matches staged artifact.' }
      } else {
        Write-Info 'DryRun: hash comparison skipped for destination.'
      }
    } catch {
      Write-Warn "Dashboard verification failed: $_"
    }
  } else {
    Write-Warn 'Dashboard file not found in staging (dist/metrics/httpServer.js)'
  }
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
  # Write a lightweight version env file for sourcing prior to start (PACKAGE_VERSION used by dashboard resolver)
  try {
    $verEnvPath = Join-Path $Destination 'version.env'
    "# Auto-generated by deploy-prod.ps1`nPACKAGE_VERSION=$pkgVersion" | Out-File -Encoding UTF8 $verEnvPath
    Write-Info "Wrote version.env with PACKAGE_VERSION=$pkgVersion"
  } catch { Write-Warn "Failed to write version.env: $_" }
  Write-Info "Deployment complete in $($manifest.durationSeconds)s"
} else {
  Write-Info 'DryRun manifest:'
  $manifest | ConvertTo-Json -Depth 4 | Write-Host
}

if(-not $DryRun -and $restoreLearned){
  try {
    $destLearned = Join-Path $Destination 'learned-safe.json'
    if(Test-Path $existingLearnedPath){
      Copy-Item $existingLearnedPath $destLearned -Force
      Write-Info 'Restored previous learned-safe.json (preserving learning data).'
    }
  } catch {
    Write-Warn "Failed to restore learned-safe.json: $_"
  }
}

# Optional post-deploy health check (basic HTTP probes)
$healthOk = $false
if($HealthCheck -and -not $DryRun){
  Write-Info "Performing health check on port $HealthPort ..."
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
  $dashOk = $false; $metricsOk = $false
  while((Get-Date) -lt $deadline -and (-not ($dashOk -and $metricsOk))){
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$HealthPort/dash.js" -TimeoutSec 3 -ErrorAction Stop; if($r.StatusCode -eq 200 -and $r.Content.Length -gt 500){ $dashOk = $true } } catch {}
    try { $m = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$HealthPort/api/metrics" -TimeoutSec 3 -ErrorAction Stop; if($m.StatusCode -eq 200 -and $m.Content.Length -gt 50){ $metricsOk = $true } } catch {}
    if(-not ($dashOk -and $metricsOk)){ Start-Sleep -Milliseconds 400 }
  }
  if($dashOk -and $metricsOk){ Write-Info 'Health check passed (dash.js + /api/metrics reachable).'; $healthOk = $true } else { Write-Warn 'Health check failed or timed out.' }
}

if(-not $DryRun){
  # Append health result into manifest if it already exists
  $manifestPath = Join-Path $Destination 'deploy-manifest.json'
  if(Test-Path $manifestPath){
    try {
      $manifestJson = Get-Content $manifestPath -Raw | ConvertFrom-Json
      $manifestJson.healthCheck = @{ enabled = [bool]$HealthCheck; ok = [bool]$healthOk; port = $HealthPort }
      $manifestJson | ConvertTo-Json -Depth 8 | Out-File -Encoding UTF8 $manifestPath
      Write-Info 'Updated manifest with healthCheck results.'
    } catch { Write-Warn "Failed to update manifest healthCheck: $_" }
  }
}

if($Entrypoint -eq 'server') { $startCmd = 'node dist/server.js' } else { $startCmd = 'node dist/mcpServer.js' }
Write-Info ("Start command suggestion: $startCmd")
Write-Info 'Set METRICS_PORT before starting if you need a non-default port.'
Write-Info 'Deployment script finished.'
