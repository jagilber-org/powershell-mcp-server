# PowerShell MCP Server - Usage Examples

This file contains correct usage patterns to avoid common errors.

## confirmed Parameter Examples

### X Common Mistakes

```json
// Wrong parameter name
{"name":"run_powershell","arguments":{"command":"git commit","confirmed":true}}

// Wrong parameter name variations
{"name":"run_powershell","arguments":{"command":"git commit","confirmed":true}}
{"name":"run_powershell","arguments":{"command":"git commit","approve":true}}
```

### * Correct Usage

```json
// Correct: Use "confirmed" parameter
{"name":"run_powershell","arguments":{"command":"git commit","confirmed":true}}

// With working directory
{"name":"run_powershell","arguments":{"command":"Get-ChildItem *.ps1","working_directory":"C:\\Your\\Project","confirmed":true}}

// Script execution
{"name":"run_powershellscript","arguments":{"scriptFile":"build.ps1","working_directory":"C:\\Your\\Project","confirmed":true}}
```

## Working Directory Examples

### Global MCP Server Context

When using a global MCP server (configured in VS Code settings), always specify absolute paths:

```json
// X Wrong: Relative path (resolved against server startup directory)
{"name":"run_powershell","arguments":{"command":"Get-ChildItem","working_directory":"./src"}}

// * Correct: Absolute path to actual workspace
{"name":"run_powershell","arguments":{"command":"Get-ChildItem","working_directory":"C:\\Code\\MyProject\\src"}}
```

### Security Policy Examples

```json
// Check current policy
{"name":"working_directory_policy","arguments":{"action":"get"}}

// Update allowed roots for global server
{"name":"working_directory_policy","arguments":{
  "action":"set",
  "allowedWriteRoots":["C:\\Code","C:\\Projects","${TEMP}"],
  "enabled":true
}}
```

## Complete Examples

### SAFE Command (Executes Immediately)

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"run_powershell",
  "arguments":{
    "command":"Get-ChildItem *.ps1 | Select-Object Name,Length",
    "working_directory":"C:\\Your\\Workspace"
  }
}}
```

### RISKY Command (requires confirmed:true)

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"run_powershell",
  "arguments":{
    "command":"git add . && git commit -m 'update files'",
    "working_directory":"C:\\Your\\Workspace",
    "confirmed":true
  }
}}
```

### UNKNOWN Command - First Call (requires confirmed:true)

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name":"run_powershell",
  "arguments":{
    "command":"custom-tool.exe --process-data",
    "working_directory":"C:\\Your\\Workspace",
    "confirmed":true
  }
}}
```

### Same UNKNOWN Command - After Learning (No confirmed Needed)

```json
// After the custom-tool.exe is learned and approved via learning system:
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
  "name":"run_powershell",
  "arguments":{
    "command":"custom-tool.exe --process-data",
    "working_directory":"C:\\Your\\Workspace"
    // No "confirmed": true needed - now classified as SAFE
  }
}}
```

### Script File Execution
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
  "name":"run_powershellscript",
  "arguments":{
    "scriptFile":"scripts/deploy.ps1",
    "working_directory":"C:\\Your\\Workspace",
    "confirmed":true,
  "timeout_seconds":120
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
  "name":"server_stats",
  "arguments":{"verbose":true}
}}
```

### Security Assessment Preview
```json
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{
  "name":"powershell_syntax_check",
  "arguments":{"script":"Remove-Item ./temp.txt"}
}}
```
