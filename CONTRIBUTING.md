# Contributing to PowerShell MCP Server

Thank you for your interest in contributing! This document outlines the process for contributing to this MCP server.

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build:only`
4. Run tests: `npm run test:jest`

## Project Structure

```text
+-- .github/          # GitHub-specific files (workflows, templates, copilot instructions)
+-- bin/             # Executable scripts and legacy entry points
+-- build/           # Build scripts and tools
+-- config/          # Configuration files (enterprise, jest, mcp)
+-- data/            # Runtime data (learning, metrics, knowledge index)
+-- deploy/          # Deployment artifacts and scripts
+-- docs/            # Documentation
+-- logs/            # Runtime logs
+-- scripts/         # Development and maintenance scripts
+-- src/             # Source code
+-- temp/            # Temporary files and build artifacts
+-- tests/           # Test files
+-- tools/           # Development tools and utilities
```

## Code Style

- Follow TypeScript best practices
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Maintain consistent indentation (2 spaces)

## Testing

- Write tests for new functionality
- Ensure all tests pass before submitting PR
- Test both enterprise and standard configurations
- Verify security classification works correctly

## Security Considerations

- All PowerShell commands are security classified
- Dangerous operations require confirmation
- Audit logging is mandatory for production
- Follow principle of least privilege

## Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add/update tests as needed
5. Update documentation
6. Submit a pull request

## Code Review

All submissions require review. We use GitHub pull requests for this purpose.

## Reporting Issues

Use the GitHub issue tracker for:

- Bug reports
- Feature requests  
- Documentation improvements

For security issues, see SECURITY.md.
