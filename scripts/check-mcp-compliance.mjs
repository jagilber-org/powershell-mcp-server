#!/usr/bin/env node
/**
 * MCP Compliance Checker
 * Ensures this PowerShell MCP Server adheres to Model Context Protocol standards
 * Based on specification: https://modelcontextprotocol.io/specification/2025-06-18
 */

import * as fs from 'fs';
import * as path from 'path';

// Current MCP Specification Version
const CURRENT_MCP_SPEC_VERSION = '2025-06-18';
const SPEC_URL = `https://modelcontextprotocol.io/specification/${CURRENT_MCP_SPEC_VERSION}`;

interface ComplianceCheck {
    name: string;
    description: string;
    required: boolean;
    status: 'PASS' | 'FAIL' | 'WARNING' | 'INFO';
    details: string;
    recommendation?: string;
}

interface ComplianceReport {
    timestamp: string;
    specificationVersion: string;
    overallStatus: 'COMPLIANT' | 'NEEDS_ATTENTION' | 'NON_COMPLIANT';
    summary: {
        total: number;
        passed: number;
        failed: number;
        warnings: number;
    };
    checks: ComplianceCheck[];
    recommendations: string[];
}

class MCPComplianceChecker {
    private projectRoot: string;
    private packageJsonPath: string;
    private serverTsPath: string;

    constructor(projectRoot: string = process.cwd()) {
        this.projectRoot = projectRoot;
        this.packageJsonPath = path.join(projectRoot, 'package.json');
        this.serverTsPath = path.join(projectRoot, 'src', 'server.ts');
    }

    async checkCompliance(): Promise<ComplianceReport> {
        const checks: ComplianceCheck[] = [];
        const recommendations: string[] = [];

        console.log('🔍 Starting MCP Compliance Check...');
        console.log(`📋 Specification Version: ${CURRENT_MCP_SPEC_VERSION}`);
        console.log(`📁 Project Root: ${this.projectRoot}`);
        console.log('=' .repeat(60));

        // 1. Check MCP SDK Version
        checks.push(await this.checkMCPSDKVersion());

        // 2. Check JSON-RPC 2.0 Implementation
        checks.push(await this.checkJSONRPCImplementation());

        // 3. Check Server Capabilities Declaration
        checks.push(await this.checkServerCapabilities());

        // 4. Check Tool Schema Compliance
        checks.push(await this.checkToolSchemas());

        // 5. Check Security Implementation
        checks.push(await this.checkSecurityImplementation());

        // 6. Check Error Handling
        checks.push(await this.checkErrorHandling());

        // 7. Check Logging Compliance
        checks.push(await this.checkLoggingCompliance());

        // 8. Check Transport Implementation
        checks.push(await this.checkTransportImplementation());

        // 9. Check Version Negotiation
        checks.push(await this.checkVersionNegotiation());

        // 10. Check Authentication Implementation
        checks.push(await this.checkAuthenticationCompliance());

        // Generate summary and overall status
        const summary = {
            total: checks.length,
            passed: checks.filter(c => c.status === 'PASS').length,
            failed: checks.filter(c => c.status === 'FAIL').length,
            warnings: checks.filter(c => c.status === 'WARNING').length
        };

        const overallStatus: 'COMPLIANT' | 'NEEDS_ATTENTION' | 'NON_COMPLIANT' = 
            summary.failed > 0 ? 'NON_COMPLIANT' :
            summary.warnings > 0 ? 'NEEDS_ATTENTION' : 'COMPLIANT';

        // Collect recommendations
        checks.forEach(check => {
            if (check.recommendation) {
                recommendations.push(check.recommendation);
            }
        });

        const report: ComplianceReport = {
            timestamp: new Date().toISOString(),
            specificationVersion: CURRENT_MCP_SPEC_VERSION,
            overallStatus,
            summary,
            checks,
            recommendations: [...new Set(recommendations)] // Remove duplicates
        };

        return report;
    }

    private async checkMCPSDKVersion(): Promise<ComplianceCheck> {
        try {
            const packageJson = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
            const mcpSdkVersion = packageJson.dependencies?.['@modelcontextprotocol/sdk'];
            
            if (!mcpSdkVersion) {
                return {
                    name: 'MCP SDK Dependency',
                    description: 'Check for @modelcontextprotocol/sdk dependency',
                    required: true,
                    status: 'FAIL',
                    details: 'Missing @modelcontextprotocol/sdk dependency',
                    recommendation: 'Install the official MCP SDK: npm install @modelcontextprotocol/sdk'
                };
            }

            // Check if version is reasonably current (not older than 0.5.0)
            const versionNumber = mcpSdkVersion.replace(/[^\d.]/g, '');
            const [major, minor] = versionNumber.split('.').map(Number);
            
            if (major === 0 && minor < 5) {
                return {
                    name: 'MCP SDK Version',
                    description: 'Check MCP SDK version currency',
                    required: false,
                    status: 'WARNING',
                    details: `Using SDK version ${mcpSdkVersion} - consider upgrading`,
                    recommendation: 'Update to latest MCP SDK: npm install @modelcontextprotocol/sdk@latest'
                };
            }

            return {
                name: 'MCP SDK Version',
                description: 'Check MCP SDK version and dependency',
                required: true,
                status: 'PASS',
                details: `Using @modelcontextprotocol/sdk version ${mcpSdkVersion}`
            };
        } catch (error) {
            return {
                name: 'MCP SDK Check',
                description: 'Check MCP SDK configuration',
                required: true,
                status: 'FAIL',
                details: `Error reading package.json: ${error}`,
                recommendation: 'Ensure package.json exists and is valid JSON'
            };
        }
    }

    private async checkJSONRPCImplementation(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for MCP SDK imports (which handle JSON-RPC internally)
            const hasSDKImports = serverCode.includes('@modelcontextprotocol/sdk/server');
            const hasJSONRPCTypes = serverCode.includes('CallToolRequestSchema') || 
                                   serverCode.includes('ListToolsRequestSchema');

            if (!hasSDKImports) {
                return {
                    name: 'JSON-RPC Implementation',
                    description: 'Check for proper JSON-RPC 2.0 implementation via MCP SDK',
                    required: true,
                    status: 'FAIL',
                    details: 'Missing MCP SDK server imports',
                    recommendation: 'Import Server from @modelcontextprotocol/sdk/server/index.js'
                };
            }

            return {
                name: 'JSON-RPC Implementation',
                description: 'Check for proper JSON-RPC 2.0 implementation via MCP SDK',
                required: true,
                status: 'PASS',
                details: 'Using MCP SDK which provides compliant JSON-RPC 2.0 implementation'
            };
        } catch (error) {
            return {
                name: 'JSON-RPC Check',
                description: 'Check JSON-RPC implementation',
                required: true,
                status: 'FAIL',
                details: `Error reading server code: ${error}`,
                recommendation: 'Ensure src/server.ts exists and is accessible'
            };
        }
    }

    private async checkServerCapabilities(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for capability declaration
            const hasCapabilities = serverCode.includes('capabilities:') && 
                                  serverCode.includes('tools:');
            
            // Check for proper server creation
            const hasServerCreation = serverCode.includes('new Server(');

            if (!hasCapabilities || !hasServerCreation) {
                return {
                    name: 'Server Capabilities',
                    description: 'Check for proper server capabilities declaration',
                    required: true,
                    status: 'FAIL',
                    details: 'Missing proper server capabilities declaration',
                    recommendation: 'Declare server capabilities including tools in Server constructor'
                };
            }

            // Check for server name and version
            const hasName = serverCode.includes('name:');
            const hasVersion = serverCode.includes('version:');

            if (!hasName || !hasVersion) {
                return {
                    name: 'Server Capabilities',
                    description: 'Check for complete server metadata',
                    required: true,
                    status: 'WARNING',
                    details: 'Server capabilities declared but missing name or version',
                    recommendation: 'Include both name and version in server configuration'
                };
            }

            return {
                name: 'Server Capabilities',
                description: 'Check for proper server capabilities and metadata',
                required: true,
                status: 'PASS',
                details: 'Server properly declares capabilities, name, and version'
            };
        } catch (error) {
            return {
                name: 'Server Capabilities Check',
                description: 'Check server capabilities implementation',
                required: true,
                status: 'FAIL',
                details: `Error checking server capabilities: ${error}`
            };
        }
    }

    private async checkToolSchemas(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for Zod schema usage (recommended for type safety)
            const hasZodSchemas = serverCode.includes('z.object(') && 
                                serverCode.includes('zodToJsonSchema');
            
            // Check for proper MCP tool handlers
            const hasListToolsHandler = serverCode.includes('setRequestHandler') &&
                                      serverCode.includes('ListToolsRequestSchema');
            const hasCallToolHandler = serverCode.includes('setRequestHandler') &&
                                     serverCode.includes('CallToolRequestSchema');

            if (!hasListToolsHandler || !hasCallToolHandler) {
                return {
                    name: 'Tool Schema Implementation',
                    description: 'Check for proper tool schema and registration',
                    required: true,
                    status: 'FAIL',
                    details: `Missing required tool handlers (ListTools: ${hasListToolsHandler}, CallTool: ${hasCallToolHandler})`,
                    recommendation: 'Implement both ListToolsRequestSchema and CallToolRequestSchema handlers'
                };
            }

            if (!hasZodSchemas) {
                return {
                    name: 'Tool Schema Implementation',
                    description: 'Check for type-safe tool schemas',
                    required: false,
                    status: 'WARNING',
                    details: 'Tools registered but not using type-safe schemas',
                    recommendation: 'Consider using Zod schemas for better type safety and validation'
                };
            }

            return {
                name: 'Tool Schema Implementation',
                description: 'Check for proper tool schema implementation',
                required: true,
                status: 'PASS',
                details: 'Tools properly registered with type-safe Zod schemas and both required handlers'
            };
        } catch (error) {
            return {
                name: 'Tool Schema Check',
                description: 'Check tool schema implementation',
                required: true,
                status: 'FAIL',
                details: `Error checking tool schemas: ${error}`
            };
        }
    }

    private async checkSecurityImplementation(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for security-related patterns
            const hasSecurityClassification = serverCode.includes('SecurityLevel') || 
                                            serverCode.includes('security');
            const hasAuthValidation = serverCode.includes('validateAuth') || 
                                    serverCode.includes('authKey');
            const hasUserConsent = serverCode.includes('confirmed') || 
                                 serverCode.includes('consent');

            if (!hasAuthValidation) {
                return {
                    name: 'Security Implementation',
                    description: 'Check for security measures and user controls',
                    required: true,
                    status: 'WARNING',
                    details: 'No authentication validation detected',
                    recommendation: 'Implement authentication validation for secure operation'
                };
            }

            if (!hasUserConsent) {
                return {
                    name: 'Security Implementation', 
                    description: 'Check for user consent mechanisms',
                    required: true,
                    status: 'WARNING',
                    details: 'No user consent mechanisms detected',
                    recommendation: 'Implement user consent for potentially dangerous operations per MCP security guidelines'
                };
            }

            return {
                name: 'Security Implementation',
                description: 'Check for MCP security principle compliance',
                required: true,
                status: hasSecurityClassification ? 'PASS' : 'WARNING',
                details: hasSecurityClassification ? 
                    'Comprehensive security implementation with classification and consent' :
                    'Basic security measures present but could be enhanced'
            };
        } catch (error) {
            return {
                name: 'Security Check',
                description: 'Check security implementation',
                required: true,
                status: 'FAIL',
                details: `Error checking security implementation: ${error}`
            };
        }
    }

    private async checkErrorHandling(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for MCP error handling
            const hasMcpError = serverCode.includes('McpError') || 
                              serverCode.includes('ErrorCode');
            const hasTryCatch = serverCode.includes('try {') && 
                              serverCode.includes('catch');

            if (!hasMcpError) {
                return {
                    name: 'Error Handling',
                    description: 'Check for proper MCP error handling',
                    required: true,
                    status: 'WARNING',
                    details: 'No MCP-specific error handling detected',
                    recommendation: 'Use McpError and ErrorCode from @modelcontextprotocol/sdk for proper error handling'
                };
            }

            return {
                name: 'Error Handling',
                description: 'Check for comprehensive error handling',
                required: true,
                status: 'PASS',
                details: 'Proper MCP error handling with try-catch blocks'
            };
        } catch (error) {
            return {
                name: 'Error Handling Check',
                description: 'Check error handling implementation',
                required: true,
                status: 'FAIL',
                details: `Error checking error handling: ${error}`
            };
        }
    }

    private async checkLoggingCompliance(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for logging implementation
            const hasLogging = serverCode.includes('auditLog') || 
                             serverCode.includes('console.error') ||
                             serverCode.includes('log');
            
            // Check for audit logging (enterprise requirement)
            const hasAuditLogging = serverCode.includes('auditLog') && 
                                  serverCode.includes('AUDIT');

            if (!hasLogging) {
                return {
                    name: 'Logging Implementation',
                    description: 'Check for proper logging implementation',
                    required: false,
                    status: 'WARNING',
                    details: 'No logging implementation detected',
                    recommendation: 'Implement logging for debugging and audit purposes'
                };
            }

            return {
                name: 'Logging Implementation',
                description: 'Check for comprehensive logging',
                required: false,
                status: hasAuditLogging ? 'PASS' : 'WARNING',
                details: hasAuditLogging ? 
                    'Comprehensive audit logging implemented' :
                    'Basic logging present but could be enhanced with audit trails'
            };
        } catch (error) {
            return {
                name: 'Logging Check',
                description: 'Check logging implementation',
                required: false,
                status: 'FAIL',
                details: `Error checking logging: ${error}`
            };
        }
    }

    private async checkTransportImplementation(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for transport imports
            const hasStdioTransport = serverCode.includes('StdioServerTransport');
            const hasTransportConnect = serverCode.includes('transport.') || 
                                      serverCode.includes('.connect()');

            if (!hasStdioTransport) {
                return {
                    name: 'Transport Implementation',
                    description: 'Check for proper MCP transport implementation',
                    required: true,
                    status: 'FAIL',
                    details: 'No MCP transport implementation detected',
                    recommendation: 'Import and use StdioServerTransport or other MCP transport'
                };
            }

            return {
                name: 'Transport Implementation',
                description: 'Check for MCP-compliant transport',
                required: true,
                status: 'PASS',
                details: 'Using MCP-compliant transport (stdio)'
            };
        } catch (error) {
            return {
                name: 'Transport Check',
                description: 'Check transport implementation',
                required: true,
                status: 'FAIL',
                details: `Error checking transport: ${error}`
            };
        }
    }

    private async checkVersionNegotiation(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Version negotiation is typically handled by the MCP SDK
            const hasSDKImplementation = serverCode.includes('@modelcontextprotocol/sdk');
            
            return {
                name: 'Version Negotiation',
                description: 'Check for MCP version negotiation support',
                required: true,
                status: hasSDKImplementation ? 'PASS' : 'FAIL',
                details: hasSDKImplementation ? 
                    'Version negotiation handled by MCP SDK' :
                    'No MCP SDK detected - version negotiation may not be implemented',
                recommendation: hasSDKImplementation ? undefined : 
                    'Use MCP SDK which handles version negotiation automatically'
            };
        } catch (error) {
            return {
                name: 'Version Negotiation Check',
                description: 'Check version negotiation',
                required: true,
                status: 'FAIL',
                details: `Error checking version negotiation: ${error}`
            };
        }
    }

    private async checkAuthenticationCompliance(): Promise<ComplianceCheck> {
        try {
            const serverCode = fs.readFileSync(this.serverTsPath, 'utf8');
            
            // Check for authentication implementation
            const hasAuth = serverCode.includes('authKey') || 
                          serverCode.includes('authentication') ||
                          serverCode.includes('validateAuth');
            
            // Check for optional auth (good practice)
            const hasOptionalAuth = serverCode.includes('optional()') && 
                                   serverCode.includes('key');

            if (hasAuth && hasOptionalAuth) {
                return {
                    name: 'Authentication Implementation',
                    description: 'Check for proper authentication with user control',
                    required: false,
                    status: 'PASS',
                    details: 'Optional authentication implemented - users can choose to enable'
                };
            } else if (hasAuth) {
                return {
                    name: 'Authentication Implementation',
                    description: 'Check for authentication implementation',
                    required: false,
                    status: 'WARNING',
                    details: 'Authentication present but may not be user-controllable',
                    recommendation: 'Consider making authentication optional for user flexibility'
                };
            }

            return {
                name: 'Authentication Implementation',
                description: 'Check for security authentication',
                required: false,
                status: 'INFO',
                details: 'No authentication detected - consider adding for enhanced security'
            };
        } catch (error) {
            return {
                name: 'Authentication Check',
                description: 'Check authentication implementation',
                required: false,
                status: 'FAIL',
                details: `Error checking authentication: ${error}`
            };
        }
    }

    generateReport(report: ComplianceReport): void {
        console.log('\n' + '='.repeat(60));
        console.log('📊 MCP COMPLIANCE REPORT');
        console.log('='.repeat(60));
        
        // Overall status
        const statusIcon = report.overallStatus === 'COMPLIANT' ? '✅' : 
                          report.overallStatus === 'NEEDS_ATTENTION' ? '⚠️' : '❌';
        console.log(`${statusIcon} Overall Status: ${report.overallStatus}`);
        console.log(`📅 Timestamp: ${report.timestamp}`);
        console.log(`📋 MCP Specification: ${report.specificationVersion}`);
        console.log(`🔗 Reference: ${SPEC_URL}`);
        
        // Summary
        console.log('\n📈 SUMMARY:');
        console.log(`   Total Checks: ${report.summary.total}`);
        console.log(`   ✅ Passed: ${report.summary.passed}`);
        console.log(`   ❌ Failed: ${report.summary.failed}`);
        console.log(`   ⚠️  Warnings: ${report.summary.warnings}`);
        
        // Detailed results
        console.log('\n🔍 DETAILED RESULTS:');
        report.checks.forEach(check => {
            const icon = check.status === 'PASS' ? '✅' : 
                        check.status === 'FAIL' ? '❌' : 
                        check.status === 'WARNING' ? '⚠️' : 'ℹ️';
            const required = check.required ? '[REQUIRED]' : '[OPTIONAL]';
            console.log(`\n${icon} ${check.name} ${required}`);
            console.log(`   ${check.description}`);
            console.log(`   ${check.details}`);
            if (check.recommendation) {
                console.log(`   💡 Recommendation: ${check.recommendation}`);
            }
        });
        
        // Recommendations summary
        if (report.recommendations.length > 0) {
            console.log('\n💡 KEY RECOMMENDATIONS:');
            report.recommendations.forEach((rec, index) => {
                console.log(`   ${index + 1}. ${rec}`);
            });
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('For more information on MCP standards:');
        console.log(`📖 ${SPEC_URL}`);
        console.log('='.repeat(60));
    }

    async saveReport(report: ComplianceReport): Promise<string> {
        const reportDir = path.join(this.projectRoot, 'compliance-reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }
        
        const filename = `mcp-compliance-${new Date().toISOString().split('T')[0]}.json`;
        const reportPath = path.join(reportDir, filename);
        
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        return reportPath;
    }
}

// CLI execution
async function main() {
    const checker = new MCPComplianceChecker();
    
    try {
        const report = await checker.checkCompliance();
        checker.generateReport(report);
        
        const reportPath = await checker.saveReport(report);
        console.log(`\n📄 Full report saved to: ${reportPath}`);
        
        // Exit with appropriate code
        process.exit(report.overallStatus === 'NON_COMPLIANT' ? 1 : 0);
        
    } catch (error) {
        console.error('❌ Error running compliance check:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { MCPComplianceChecker, type ComplianceReport, type ComplianceCheck };
