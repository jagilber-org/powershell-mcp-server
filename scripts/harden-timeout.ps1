param()
$ErrorActionPreference = 'Stop'
$file = 'src/tools/runPowerShell.ts'
if(-not (Test-Path $file)){ throw "File not found: $file" }
$text = Get-Content $file -Raw
if($text -match 'originalTimeoutSeconds'){ Write-Host 'Already hardened'; exit 0 }
# Replace timeout handling block
$timeoutPattern = 'let timeoutSeconds[\s\S]*?const timeout = Math\.round\(timeoutSeconds \* 1000\);'
$newTimeout = @"
let timeoutSeconds = args.aiAgentTimeoutSec || args.aiAgentTimeout || args.timeout;
const warnings: string[] = [];
const MAX_TIMEOUT_SECONDS = ENTERPRISE_CONFIG.limits?.maxTimeoutSeconds ?? 600;
const usedLegacy = (!!args.aiAgentTimeout && !args.aiAgentTimeoutSec);
const usedGeneric = (!!args.timeout && !args.aiAgentTimeoutSec && !args.aiAgentTimeout);
if(usedLegacy){ warnings.push("Parameter 'aiAgentTimeout' is deprecated; use 'aiAgentTimeoutSec' (seconds)."); }
if(usedGeneric){ warnings.push("Parameter 'timeout' is deprecated; use 'aiAgentTimeoutSec' (seconds)."); }
if(typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0){
  timeoutSeconds = (ENTERPRISE_CONFIG.limits.defaultTimeoutMs || 90000) / 1000;
}
if(timeoutSeconds > MAX_TIMEOUT_SECONDS){ throw new McpError(ErrorCode.InvalidParams, `Timeout ${timeoutSeconds}s exceeds max allowed ${MAX_TIMEOUT_SECONDS}s`); }
if(timeoutSeconds >= 60){ warnings.push(`Long timeout ${timeoutSeconds}s may reduce responsiveness.`); }
const timeout = Math.round(timeoutSeconds * 1000);
"@
$updated = [System.Text.RegularExpressions.Regex]::Replace($text, $timeoutPattern, $newTimeout, 'Singleline')
if($updated -eq $text){ throw 'Timeout block replace failed (pattern not matched).' }
# Replace response object construction
$responsePattern = 'const responseObject = \{ \.\.\.result, securityAssessment: assessment \};'
$responseReplace = 'const responseObject = { ...result, securityAssessment: assessment, originalTimeoutSeconds: timeoutSeconds, warnings };'
$updated2 = [regex]::Replace($updated, $responsePattern, $responseReplace)
if($updated2 -eq $updated){ throw 'Response object replace failed (pattern not matched).' }
Set-Content $file $updated2 -Encoding UTF8
Write-Host 'Patched runPowerShell.ts with timeout hardening.'
