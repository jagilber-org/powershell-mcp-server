# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.3.x   | :white_check_mark: |
| 1.2.x   | :white_check_mark: |
| < 1.2   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities by:

1. **DO NOT** create a public GitHub issue
2. Email security concerns to the repository maintainers
3. Include detailed steps to reproduce
4. Include affected versions

### Expected Response Time

- Initial acknowledgment: 48 hours
- Status update: 7 days
- Resolution timeline: Depends on severity

### Security Features

This MCP server includes enterprise-grade security features:

- Command classification and risk assessment
- Audit logging with NDJSON format
- Rate limiting and timeout controls
- Working directory enforcement
- Content filtering and PII detection
- Secure credential handling

### Security Best Practices

When deploying this MCP server:

1. Use the enterprise configuration (`config/enterprise-config.json`)
2. Set appropriate working directory restrictions
3. Configure audit logging
4. Use strong authentication keys
5. Monitor logs for suspicious activity
6. Keep dependencies updated
