param(
  [string]$OutFile = 'mcp-index-template.zip'
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
if(Test-Path $OutFile){ Remove-Item $OutFile -Force }
# Exclude any existing zip or transient files
$items = Get-ChildItem -Force -Recurse | Where-Object { $_.FullName -notmatch '\.zip$' }
Compress-Archive -Path ($items | ForEach-Object { $_.FullName }) -DestinationPath $OutFile -Force
Write-Host "Packaged template -> $OutFile"
