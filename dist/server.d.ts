export declare class PowerShellMcpServer {
    private server;
    private httpServer;
    private httpPort;
    private httpKey;
    private isHttpServerRunning;
    constructor();
    private startHttpServer;
    private handleHttpRequest;
    private setupHandlers;
    private executePowerShellCommand;
    private executePowerShellScript;
    private executePowerShellFile;
    private executePowerShellViaHttp;
    start(): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=server.d.ts.map