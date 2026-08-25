import { Server } from "@modelcontextprotocol/sdk/server/index.js";
export interface Breakpoint {
    name: string;
    width: number;
    height: number;
}
export interface CommandResult {
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    /** Raw stdout, retained for binary commands such as screencap. */
    stdoutBuffer: Buffer;
    timedOut: boolean;
    truncated: boolean;
    durationMs: number;
    spawnError?: string;
}
export interface FlutterTestResult {
    ok: boolean;
    status: "passed" | "failed" | "timed_out" | "spawn_error";
    command: string[];
    cwd: string;
    exitCode: number | null;
    signal: string | null;
    durationMs: number;
    timedOut: boolean;
    passCount: number | null;
    failCount: number | null;
    skippedCount: number | null;
    testCount: number | null;
    noTestsDetected: boolean;
    allTestsSkipped: boolean;
    overflowDetected: boolean;
    overflowLines: Array<{
        lineNumber: number;
        text: string;
    }>;
    stackTrace: string[];
    stdout: string;
    stderr: string;
    outputTruncated: boolean;
    spawnError?: string;
}
export interface AnalyzerIssue {
    severity: "error" | "warning" | "info";
    code: string | null;
    message: string;
    correction: string | null;
    file: string | null;
    line: number | null;
    column: number | null;
    length: number | null;
    url: string | null;
}
/** Resolve a user supplied path and reject traversal outside the project. */
export declare function resolveProjectPath(input: string, label?: string): string;
/**
 * Run a process without a shell, with bounded output and a hard timeout.
 * Keeping this helper central makes every tool resistant to shell injection.
 */
export declare function runCommand(command: string, args: string[], options: {
    cwd: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    windowsVerbatimArguments?: boolean;
}): Promise<CommandResult>;
export declare function commandForAgent(command: string[]): string[];
/** Parse Flutter's human and --machine output into a stable result object. */
export declare function parseFlutterTestOutput(result: Pick<CommandResult, "code" | "signal" | "stdout" | "stderr" | "timedOut" | "truncated" | "durationMs" | "spawnError">, command: string[], cwd: string): FlutterTestResult;
export declare function sanitizeAnalyzerFile(file: string | null): string | null;
/** Parse analyzer JSON-lines, pipe machine output and legacy text output. */
export declare function parseAnalyzerOutput(stdout: string, stderr?: string): AnalyzerIssue[];
interface IosDeviceInfo {
    identifier: string;
    name: string | null;
    platform: string | null;
    model: string | null;
    osVersion: string | null;
    state: string | null;
    transport: string | null;
    pairingState: string | null;
    developerModeStatus: string | null;
    available: boolean;
}
export interface XcresultSummary {
    ok: boolean;
    result: string | null;
    totalTestCount: number | null;
    passedTests: number | null;
    failedTests: number | null;
    skippedTests: number | null;
    expectedFailures: number | null;
    durationSeconds: number | null;
    noTestsDetected: boolean;
    allTestsSkipped: boolean;
    failures: Array<{
        testName: string | null;
        targetName: string | null;
        failureText: string;
        file: string | null;
        line: number | null;
    }>;
}
/** Normalize the stable, non-sensitive portion of devicectl's evolving JSON schema. */
export declare function parseDevicectlDevices(value: unknown): IosDeviceInfo[];
/** Parse the bounded summary emitted by Xcode 16+'s xcresulttool. */
export declare function parseXcresultSummary(value: unknown, maxFailures?: number): XcresultSummary;
export declare function createServer(): Promise<Server>;
export declare function main(): Promise<void>;
export {};
