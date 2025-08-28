# Critical Timeout Test Commands

## DO NOT REMOVE OR MODIFY

This document preserves the critical PowerShell commands used for timeout hardening tests. These commands are specifically engineered to create reliable hanging scenarios for testing timeout enforcement.

## Primary Hang Test Command

```powershell
while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }
```

### Why This Specific Command?

1. **Infinite Loop**: `while($true)` ensures the command never exits naturally
2. **Blocking Wait**: `[System.Console]::ReadKey($true)` creates a blocking wait for keyboard input
3. **Non-echoing**: The `$true` parameter makes it non-echoing and immediate
4. **Error Handling**: The try/catch handles console errors gracefully
5. **Fallback**: Falls back to `Start-Sleep -Milliseconds 100` if console operations fail
6. **Uninterruptible**: Cannot be stopped by normal signals, requires forceful termination

### Test Validation Requirements

When using this command in tests, it MUST:
- Be terminated by timeout (`timedOut=true` OR `exitCode=124`)
- Never report `success=true`
- Run for at least 80% of configured timeout duration
- Demonstrate genuine timeout enforcement, not fast exit

### Production Validation Results

Manual execution with 5-second timeout:
```json
{
  "success": false,
  "timedOut": true,
  "duration_ms": 5033,
  "exitCode": null,
  "error": "Command timed out after 5000ms"
}
```

## Usage in Tests

```javascript
const hangCommand = 'while($true) { try { [System.Console]::ReadKey($true) | Out-Null } catch { Start-Sleep -Milliseconds 100 } }';
// Use with timeout parameter and confirmed:true
```

## Protection Notice

This command is CRITICAL for:
- Enterprise security validation
- Timeout enforcement testing  
- Prevention of false positive test results
- Real-world hang scenario simulation

**DO NOT MODIFY OR REMOVE** - any changes could break timeout validation and compromise security testing.

## Alternative Commands (For Reference Only)

These are NOT suitable for testing as they may exit early:
- `Start-Sleep -Seconds 999` (can be interrupted)
- `while($true) { Start-Sleep 1 }` (can be signaled)
- `ping -t localhost` (may exit on network issues)

Only the documented ReadKey command provides reliable hanging behavior for timeout testing.