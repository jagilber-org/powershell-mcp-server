# PowerShell MCP Server - Usage Examples

This file contains correct usage patterns to avoid common errors.

## confirmed Parameter Examples

### X Common Mistakes

```json
// Wrong parameter name
{"name":"run-powershell","arguments":{"command":"git commit","confirmed":true}}

// Wrong parameter name variations
{"name":"run-powershell","arguments":{"command":"git commit","confirmed":true}}
{"name":"run-powershell","arguments":{"command":"git commit","approve":true}}
```

### * Correct Usage

```json
// Correct: Use "confirmed" parameter
{"name":"run-powershell","arguments":{"command":"git commit","confirmed":true}}

// With working directory
{"name":"run-powershell","arguments":{"command":"Get-ChildItem *.ps1","workingDirectory":"C:\\Your\\Project","confirmed":true}}

// Script execution
{"name":"run-powershellscript","arguments":{"scriptFile":"build.ps1","workingDirectory":"C:\\Your\\Project","confirmed":true}}
```

## Working Directory Examples

### Global MCP Server Context

When using a global MCP server (configured in VS Code settings), always specify absolute paths:

```json
// X Wrong: Relative path (resolved against server startup directory)
{"name":"run-powershell","arguments":{"command":"Get-ChildItem","workingDirectory":"./src"}}

// * Correct: Absolute path to actual workspace
{"name":"run-powershell","arguments":{"command":"Get-ChildItem","workingDirectory":"C:\\Code\\MyProject\\src"}}
```

### Security Policy Examples

```json
// Check current policy
{"name":"working-directory-policy","arguments":{"action":"get"}}

// Update allowed roots for global server
{"name":"working-directory-policy","arguments":{
  "action":"set",
  "allowedWriteRoots":["C:\\Code","C:\\Projects","${TEMP}"],
  "enabled":true
}}
```

## Complete Examples

### SAFE Command (Executes Immediately)

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"run-powershell",
  "arguments":{
    "command":"Get-ChildItem *.ps1 | Select-Object Name,Length",
    "workingDirectory":"C:\\Your\\Workspace"
  }
}}
```

### RISKY Command (requires confirmed:true)

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"run-powershell",
  "arguments":{
    "command":"git add . && git commit -m 'update files'",
    "workingDirectory":"C:\\Your\\Workspace",
    "confirmed":true
  }
}}
```

### UNKNOWN Command - First Call (requires confirmed:true)

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name":"run-powershell",
  "arguments":{
    "command":"custom-tool.exe --process-data",
    "workingDirectory":"C:\\Your\\Workspace",
    "confirmed":true
  }
}}
```

### Same UNKNOWN Command - After Learning (No confirmed Needed)

```json
// After the custom-tool.exe is learned and approved via learning system:
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
  "name":"run-powershell",
  "arguments":{
    "command":"custom-tool.exe --process-data",
    "workingDirectory":"C:\\Your\\Workspace"
    // No "confirmed": true needed - now classified as SAFE
  }
}}
```

### Script File Execution
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
  "name":"run-powershellscript",
  "arguments":{
    "scriptFile":"scripts/deploy.ps1",
    "workingDirectory":"C:\\Your\\Workspace",
    "confirmed":true,
  "timeoutSeconds":120
  }
}}
```

## Learning System Examples

### Check Unknown Commands
```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{
  "name":"learn",
  "arguments":{"action":"list","limit":10}
}}
```

### Approve Command Patterns
```json
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{
  "name":"learn",
  "arguments":{
    "action":"approve",
    "normalized":["custom-tool.exe"]
  }
}}
```

## Error Diagnosis Examples

### Server Statistics
```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{
  "name":"server-stats",
  "arguments":{"verbose":true}
}}
```

### Security Assessment Preview
```json
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{
  "name":"powershell-syntax-check",
  "arguments":{"script":"Remove-Item ./temp.txt"}
}}
```
