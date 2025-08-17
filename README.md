# PowerShell MCP Server

A Model Context Protocol (MCP) server that provides secure PowerShell command execution capabilities for AI assistants. This server enables AI agents to execute PowerShell commands, scripts, and files through a structured and safe interface.

## Features

- **Multiple Execution Methods**: Direct commands, script files, PowerShell file execution, and HTTP server integration
- **Microsoft Safety Classification**: Built-in safety system using official PowerShell verb groups
- **Secure Execution**: Input validation, command sanitization, and error handling
- **Auto-generated Authentication**: Dynamic key generation for HTTP server access
- **Port Fallback**: Automatic port selection (8383→8384) if primary port is unavailable
- **TypeScript Implementation**: Full type safety with Zod schema validation

## Installation

### Prerequisites
- Node.js (v18 or higher)
- PowerShell 5.1 or PowerShell Core 7+
- Windows environment

### Setup
1. Clone or download this repository
2. Install dependencies: 
pm install
3. Build the TypeScript project: 
pm run build

## Configuration

### Claude Desktop Integration
Add the following to your Claude Desktop configuration file (claude_desktop_config.json):

`json
{
  "mcpServers": {
    "powershell-mcp": {
      "command": "node",
      "args": ["C:\\github\\jagilber-pr\\powershell-mcp-server\\dist\\server.js"],
      "env": {}
    }
  }
}
`

### Standalone Usage
You can also run the server directly: 
ode dist/server.js

## Available Tools

### 1. powershell-command
Execute PowerShell commands directly.

**Parameters:**
- command (string, required): PowerShell command to execute
- workingDirectory (string, optional): Working directory for command execution
- 	imeout (number, optional): Command timeout in milliseconds (default: 30000)

### 2. powershell-script
Execute PowerShell script content.

**Parameters:**
- script (string, required): PowerShell script content to execute
- workingDirectory (string, optional): Working directory for script execution
- 	imeout (number, optional): Script timeout in milliseconds (default: 60000)

### 3. powershell-file
Execute a PowerShell script file.

**Parameters:**
- ilePath (string, required): Path to PowerShell script file (.ps1)
- rguments (array, optional): Arguments to pass to the script
- workingDirectory (string, optional): Working directory for script execution
- 	imeout (number, optional): Script timeout in milliseconds (default: 120000)

### 4. powershell-http
Execute PowerShell commands through an HTTP server interface.

**Parameters:**
- command (string, required): PowerShell command to execute
- port (number, optional): HTTP server port (default: 8383)
- 	imeout (number, optional): Command timeout in milliseconds (default: 30000)

## Safety Classification

The server includes a comprehensive safety classification system based on Microsoft's official PowerShell verb groups:

### Safe Commands (Auto-approved)
- **Common**: Get, Find, Search, Select, etc.
- **Diagnostic**: Ping, Test, Trace, Debug, Measure, etc.

### Risky Commands (Require careful consideration)
- **Security**: Block, Grant, Protect, Unblock, Unprotect, etc.
- **Lifecycle**: Approve, Assert, Complete, Confirm, Deny, etc.
- **Data**: Backup, Checkpoint, Compare, Compress, Convert, etc.
- **Communications**: Connect, Disconnect, Read, Receive, Send, Write

## HTTP Server Features

The HTTP server component provides additional capabilities:

- **Auto-generated Keys**: Dynamic authentication key generation for secure access
- **Port Fallback**: Automatic failover from 8383 to 8384 if needed
- **JSON API**: RESTful interface for PowerShell command execution
- **Error Handling**: Comprehensive error responses and logging

### HTTP Server Usage

Start the HTTP server: .\ps-http-server.ps1

## Development

### Project Structure
`
powershell-mcp-server/
├── src/
│   ├── server.ts              # Main MCP server implementation
│   ├── server-comprehensive.ts # Extended server with additional features
│   └── test-http-standalone.ts # HTTP server testing utilities
├── dist/                      # Compiled JavaScript output
├── ps-http-server.ps1        # PowerShell HTTP server script
├── test-http-server.ps1      # HTTP server testing script
├── package.json              # Node.js dependencies and scripts
└── tsconfig.json             # TypeScript configuration
`

### Build Scripts
- 
pm run build - Compile TypeScript to JavaScript
- 
pm run dev - Development mode with file watching
- 
pm test - Run test suite

## Security Considerations

1. **Command Validation**: All commands are validated against safety classifications
2. **Input Sanitization**: User inputs are sanitized before execution
3. **Timeout Protection**: Commands have configurable timeout limits
4. **Error Containment**: Errors are captured and formatted safely
5. **Working Directory Control**: Execution directory can be controlled
6. **Authentication**: HTTP server uses auto-generated authentication keys

## Troubleshooting

### Common Issues

1. **Port Already in Use**: The server automatically tries fallback ports (8383→8384)
2. **PowerShell Execution Policy**: Ensure your PowerShell execution policy allows script execution
3. **Permission Errors**: Run with appropriate permissions for the commands you need to execute
4. **Timeout Issues**: Increase timeout values for long-running commands

### Debug Mode
Set environment variable for detailed logging: set DEBUG=powershell-mcp

## License

This project is licensed under the MIT License.

## Acknowledgments

- Built on the Model Context Protocol (MCP) framework
- Uses Microsoft's PowerShell verb classification system
- Implements TypeScript with Zod for runtime type safety
