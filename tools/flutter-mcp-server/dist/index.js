/**
 * Flutter MCP server
 *
 * The server deliberately uses argument arrays (never a shell) and keeps all
 * project paths below FLUTTER_PROJECT_ROOT/current working directory. This is
 * important when an LLM is allowed to call the tools unattended.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
const SERVER_NAME = "flutter-mcp-server";
const SERVER_VERSION = "1.0.0";
const SERVER_INSTRUCTIONS = "Flutter QA bridge rooted at FLUTTER_PROJECT_ROOT. Prefer analyze_code, then a focused run_flutter_tests, then check_layout_overflow across 320x568, 390x844, 844x390 and text scale 1.5, followed by the full suite. For a connected iOS device, use list_ios_devices, then run_ios_integration_tests or run_xcuitests, and inspect_xcresult. Tools return structured JSON; inspect ok/status/diagnostics and classify failures. ADB mutations, iOS device/test mutations, and remote VM Service access require explicit environment opt-in; query_vm_service, list_ios_devices and inspect_xcresult are read-only by default.";
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const configuredDefaultTimeout = Number(process.env.FLUTTER_MCP_TIMEOUT_MS);
const DEFAULT_TIMEOUT_MS = Number.isInteger(configuredDefaultTimeout)
    && configuredDefaultTimeout >= 1_000
    && configuredDefaultTimeout <= MAX_TIMEOUT_MS
    ? configuredDefaultTimeout
    : 120_000;
const envFlag = (name) => ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
const ALLOW_ADB_MUTATIONS = envFlag("FLUTTER_MCP_ALLOW_ADB_MUTATIONS");
const ALLOW_IOS_MUTATIONS = envFlag("FLUTTER_MCP_ALLOW_IOS_MUTATIONS");
const ALLOW_REMOTE_VM_SERVICE = envFlag("FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE");
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_CHARS = 40_000;
const PROJECT_ROOT = path.resolve(process.env.FLUTTER_PROJECT_ROOT?.trim()
    || process.env.CLAUDE_PROJECT_DIR?.trim()
    || process.cwd());
const DEFAULT_BREAKPOINTS = [
    { name: "small", width: 320, height: 568 },
    { name: "standard", width: 390, height: 844 },
    { name: "landscape", width: 844, height: 390 },
];
class ToolError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
class InputError extends ToolError {
    constructor(message) {
        super(message, "INVALID_INPUT");
    }
}
class UnsupportedPlatformError extends ToolError {
    constructor(message) {
        super(message, "UNSUPPORTED_PLATFORM");
    }
}
function asRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new InputError("Tool arguments must be a JSON object.");
    }
    return value;
}
function optionalString(args, key) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "string" || value.length === 0) {
        throw new InputError(`${key} must be a non-empty string.`);
    }
    if (value.includes("\0"))
        throw new InputError(`${key} contains a NUL byte.`);
    return value;
}
function boundedInteger(args, key, defaultValue, min, max) {
    const value = args[key];
    if (value === undefined || value === null)
        return defaultValue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        throw new InputError(`${key} must be an integer between ${min} and ${max}.`);
    }
    return value;
}
function boundedNumber(value, label, defaultValue, min, max) {
    if (value === undefined || value === null)
        return defaultValue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw new InputError(`${label} must be a number between ${min} and ${max}.`);
    }
    return value;
}
function stringArray(args, key) {
    const value = args[key];
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value) || value.length > 40 || value.some((item) => typeof item !== "string")) {
        throw new InputError(`${key} must be an array of at most 40 strings.`);
    }
    const values = value;
    if (values.some((item) => item.length > 1_000 || item.includes("\0"))) {
        throw new InputError(`${key} contains an item that is too long or contains a NUL byte.`);
    }
    return values;
}
function isWithinProject(candidate) {
    return isWithinRoot(candidate, PROJECT_ROOT);
}
function isWithinRoot(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
/** Resolve a user supplied path and reject traversal outside the project. */
export function resolveProjectPath(input, label = "path") {
    if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
        throw new InputError(`${label} must be a non-empty path.`);
    }
    const resolved = path.resolve(PROJECT_ROOT, input);
    if (!isWithinProject(resolved)) {
        throw new InputError(`${label} must stay inside the Flutter project root.`);
    }
    return resolved;
}
/**
 * Lexical traversal checks do not catch a symlink in the project that points
 * outside it. Verify the nearest existing ancestor's real path as well. The
 * nearest ancestor check also works for output files that do not exist yet.
 */
async function assertRealpathInsideProject(candidate, label) {
    const realRoot = await fs.realpath(PROJECT_ROOT).catch(() => PROJECT_ROOT);
    let probe = candidate;
    while (true) {
        try {
            const realCandidate = await fs.realpath(probe);
            if (!isWithinRoot(realCandidate, realRoot)) {
                throw new InputError(`${label} resolves through a symlink outside the Flutter project root.`);
            }
            return;
        }
        catch (error) {
            const code = error?.code;
            if (code !== "ENOENT")
                throw error;
            const parent = path.dirname(probe);
            if (parent === probe)
                return;
            probe = parent;
        }
    }
}
async function safeProjectPath(input, label) {
    const resolved = resolveProjectPath(input, label);
    await assertRealpathInsideProject(resolved, label);
    return resolved;
}
async function resolveCwd(args) {
    const requested = optionalString(args, "cwd");
    const cwd = requested ? resolveProjectPath(requested, "cwd") : PROJECT_ROOT;
    try {
        const stat = await fs.stat(cwd);
        if (!stat.isDirectory())
            throw new Error("not a directory");
    }
    catch {
        throw new InputError(`cwd does not exist or is not a directory: ${cwd}`);
    }
    await assertRealpathInsideProject(cwd, "cwd");
    return cwd;
}
function timeoutFrom(args) {
    return boundedInteger(args, "timeoutMs", DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS);
}
function relativeCommandPath(absolutePath, cwd) {
    const relative = path.relative(cwd, absolutePath);
    // Flutter accepts POSIX separators on Windows as well, and this makes the
    // command legible in logs returned to the agent.
    return (relative || ".").split(path.sep).join("/");
}
function projectRelativePath(absolutePath) {
    return relativeCommandPath(absolutePath, PROJECT_ROOT);
}
function executable(name) {
    const envName = {
        flutter: "FLUTTER_BIN",
        adb: "ADB_BIN",
        xcrun: "XCRUN_BIN",
    };
    const configured = process.env[envName[name]]?.trim();
    if (configured) {
        // A bare command in a JSON config should still resolve through PATHEXT on
        // Windows. Node's shell-free spawn does not reliably do that for .bat
        // scripts, so make the intended executable explicit.
        if (process.platform === "win32" && configured.toLowerCase() === name) {
            if (name === "flutter")
                return "flutter.bat";
            if (name === "adb")
                return "adb.exe";
        }
        return configured;
    }
    if (process.platform === "win32") {
        if (name === "flutter")
            return "flutter.bat";
        if (name === "adb")
            return "adb.exe";
    }
    return name;
}
function assertIosHost() {
    const testOverride = process.env.NODE_ENV === "test"
        && envFlag("FLUTTER_MCP_TEST_ALLOW_IOS_TOOLS")
        && Boolean(process.env.XCRUN_BIN?.trim());
    if (process.platform !== "darwin" && !testOverride) {
        throw new UnsupportedPlatformError("iOS device and XCUITest tools require macOS with full Xcode selected as the active developer directory.");
    }
}
function spawnSpec(name, args) {
    const executablePath = executable(name);
    if (process.platform !== "win32" || !/\.(?:bat|cmd)$/i.test(executablePath)) {
        return { command: executablePath, args, display: [executablePath, ...args], windowsVerbatimArguments: false };
    }
    const batch = executablePath;
    // /S /C consumes one command string. Quoting each token keeps cmd
    // metacharacters such as `&` and `|` inside the argument. Percent expansion
    // and embedded quotes happen before batch argument parsing, so reject those
    // two ambiguous forms instead of silently changing a test name/flag.
    if (args.some((value) => /[%"\r\n]/.test(value)) || /[%"\r\n]/.test(batch)) {
        throw new InputError("Windows .bat/.cmd arguments cannot contain %, quotes, or line breaks.");
    }
    const quoteCmd = (value) => {
        return `"${value}"`;
    };
    // A bare `flutter.bat` must stay unquoted: quoting a PATH-resolved batch
    // script makes Flutter calculate an invalid FLUTTER_ROOT on Windows. Paths
    // containing spaces need a quoted token and the outer pair required by
    // `cmd /s /c`.
    const batchNeedsQuote = /[\s&|<>()^%!\"]/.test(batch);
    const batchToken = batchNeedsQuote ? quoteCmd(batch) : batch;
    const commandLineInner = [batchToken, ...args.map(quoteCmd)].join(" ");
    const commandLine = batchNeedsQuote ? `"${commandLineInner}"` : commandLineInner;
    const command = process.env.ComSpec || "cmd.exe";
    return {
        command,
        args: ["/d", "/s", "/c", commandLine],
        display: [batch, ...args],
        windowsVerbatimArguments: true,
    };
}
/**
 * Run a process without a shell, with bounded output and a hard timeout.
 * Keeping this helper central makes every tool resistant to shell injection.
 */
export function runCommand(command, args, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? MAX_CAPTURE_BYTES;
    const started = Date.now();
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(command, args, {
                cwd: options.cwd,
                env: process.env,
                shell: false,
                detached: process.platform !== "win32",
                windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            resolve({
                code: null,
                signal: null,
                stdout: "",
                stderr: "",
                stdoutBuffer: Buffer.alloc(0),
                timedOut: false,
                truncated: false,
                durationMs: Date.now() - started,
                spawnError: message,
            });
            return;
        }
        const stdoutChunks = [];
        const stderrChunks = [];
        let capturedBytes = 0;
        let truncated = false;
        let timedOut = false;
        let spawnError;
        let settled = false;
        const killProcessTree = (signal) => {
            try {
                if (process.platform !== "win32" && child.pid)
                    process.kill(-child.pid, signal);
                else
                    child.kill(signal);
            }
            catch {
                // The process group may have exited between the timer tick and kill.
            }
        };
        const append = (target, chunk) => {
            if (capturedBytes >= maxOutputBytes) {
                truncated = true;
                return;
            }
            const remaining = maxOutputBytes - capturedBytes;
            const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
            target.push(accepted);
            capturedBytes += accepted.length;
            if (accepted.length < chunk.length)
                truncated = true;
        };
        child.stdout.on("data", (chunk) => append(stdoutChunks, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => append(stderrChunks, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        const timer = setTimeout(() => {
            timedOut = true;
            // SIGTERM works on POSIX and is translated by Node on Windows. A second
            // kill prevents a stuck Flutter process from keeping an MCP call open.
            killProcessTree("SIGTERM");
            setTimeout(() => {
                if (!settled)
                    killProcessTree("SIGKILL");
            }, 2_000).unref();
        }, timeoutMs);
        timer.unref();
        const finish = (code, signal) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            const stdoutBuffer = Buffer.concat(stdoutChunks);
            const stderrBuffer = Buffer.concat(stderrChunks);
            resolve({
                code,
                signal,
                stdoutBuffer,
                stdout: stdoutBuffer.toString("utf8"),
                stderr: stderrBuffer.toString("utf8"),
                timedOut,
                truncated,
                durationMs: Date.now() - started,
                ...(spawnError ? { spawnError } : {}),
            });
        };
        child.once("error", (error) => {
            spawnError = error.message;
            finish(null, null);
        });
        child.once("close", (code, signal) => finish(code, signal));
    });
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function redactProjectPathText(value) {
    let redacted = value;
    for (const root of new Set([PROJECT_ROOT, PROJECT_ROOT.replaceAll("\\", "/"), PROJECT_ROOT.replaceAll("/", "\\")])) {
        if (!root)
            continue;
        redacted = redacted.replace(new RegExp(escapeRegExp(root), "gi"), "<project-root>");
    }
    // Toolchain paths can contain the host username and are not necessarily
    // below the project root. They are useful to the child process, but should
    // not be copied into an agent transcript or a public CI log.
    const sensitivePaths = [
        process.env.FLUTTER_BIN,
        process.env.ADB_BIN,
        process.env.FLUTTER_ROOT,
        process.env.DART_SDK,
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        process.env.XCRUN_BIN,
        process.env.DEVELOPER_DIR,
        process.execPath,
    ].filter((candidate) => Boolean(candidate?.trim()));
    for (const sensitivePath of new Set(sensitivePaths)) {
        redacted = redacted.replace(new RegExp(escapeRegExp(sensitivePath), "gi"), "<local-tool>");
    }
    return redacted;
}
export function commandForAgent(command) {
    const safe = [];
    let redactNextAdbText = false;
    let redactNextIosValue = false;
    for (const [index, value] of command.entries()) {
        if (index === 0) {
            // Keep the executable name useful while removing an absolute SDK/user
            // path from structured command echoes.
            const executableName = value.split(/[\\/]/).at(-1) ?? "";
            safe.push(executableName || "<executable>");
            continue;
        }
        if (redactNextAdbText) {
            safe.push("<redacted-input-text>");
            redactNextAdbText = false;
            continue;
        }
        if (redactNextIosValue) {
            safe.push("<redacted>");
            redactNextIosValue = false;
            continue;
        }
        if (safe.at(-2) === "shell" && safe.at(-1) === "input" && value === "text") {
            safe.push(value);
            redactNextAdbText = true;
            continue;
        }
        if (/^--dart-define(?:=|$)/.test(value)) {
            safe.push(value.includes("=") ? `${value.slice(0, value.indexOf("=") + 1)}<redacted>` : value);
            continue;
        }
        if (/^--dart-define-from-file(?:=|$)/.test(value)) {
            safe.push("--dart-define-from-file=<redacted>");
            continue;
        }
        if (["--device", "-d", "--json-output"].includes(value)) {
            safe.push(value);
            redactNextIosValue = true;
            continue;
        }
        if (/^platform=iOS,id=/i.test(value)) {
            safe.push("platform=iOS,id=<redacted>");
            continue;
        }
        safe.push(redactProjectPathText(value));
    }
    return safe;
}
function redactIosDiagnostic(value, secrets = []) {
    let redacted = redactProjectPathText(value);
    for (const secret of secrets) {
        if (secret)
            redacted = redacted.replace(new RegExp(escapeRegExp(secret), "g"), "<redacted>");
    }
    return redacted
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<redacted-id>")
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{16}\b/gi, "<redacted-id>")
        .replace(/\b[0-9a-f]{40}\b/gi, "<redacted-id>");
}
function redactUriValue(value) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return redactProjectPathText(value);
        // Dart VM Service URIs use the first path segment as an auth token. The
        // trailing slash is optional, so redact both `/token/` and `/token` (and
        // preserve any method suffix such as `/getVM`).
        const authPath = parsed.pathname.match(/^\/([^/]+)(.*)$/);
        if (authPath)
            parsed.pathname = `/[redacted]${authPath[2]}`;
        parsed.search = "";
        return redactProjectPathText(parsed.toString());
    }
    catch {
        return redactProjectPathText(value);
    }
}
function sanitizeForAgent(value, key, depth = 0) {
    if (depth > 12)
        return "[redacted: nesting limit]";
    if (typeof value === "string")
        return key && /uri/i.test(key) ? redactUriValue(value) : redactProjectPathText(value);
    if (Array.isArray(value))
        return value.map((item) => sanitizeForAgent(item, key, depth + 1));
    if (value && typeof value === "object") {
        const result = {};
        for (const [entryKey, entryValue] of Object.entries(value)) {
            result[entryKey] = sanitizeForAgent(entryValue, entryKey, depth + 1);
        }
        return result;
    }
    return value;
}
function compactText(value, max = MAX_RESPONSE_CHARS) {
    const safe = redactProjectPathText(value);
    if (safe.length <= max)
        return safe;
    return `${safe.slice(0, max)}\n… output truncated …`;
}
function toolResult(payload, isError = false) {
    const safePayload = sanitizeForAgent(payload);
    const text = JSON.stringify(safePayload, null, 2);
    return {
        content: [{ type: "text", text: compactText(text) }],
        // structuredContent is useful to clients that do not want to re-parse the
        // text block. It is sanitized before leaving the process.
        structuredContent: safePayload,
        ...(isError ? { isError: true } : {}),
    };
}
function commandSummary(result) {
    return {
        exitCode: result.code,
        signal: result.signal,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        outputTruncated: result.truncated,
        ...(result.spawnError ? { spawnError: result.spawnError } : {}),
    };
}
function parseMachineEvents(output) {
    const events = [];
    for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("[")))
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed))
                events.push(...parsed);
            else
                events.push(parsed);
        }
        catch {
            // Flutter may prefix machine JSON with a timestamp; recover the object.
            const start = trimmed.indexOf("{");
            const end = trimmed.lastIndexOf("}");
            if (start >= 0 && end > start) {
                try {
                    events.push(JSON.parse(trimmed.slice(start, end + 1)));
                }
                catch {
                    // Keep parsing subsequent lines.
                }
            }
        }
    }
    return events;
}
function collectTestEventCounts(output) {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let total = 0;
    const visit = (value) => {
        if (Array.isArray(value)) {
            for (const item of value)
                visit(item);
            return;
        }
        if (!value || typeof value !== "object")
            return;
        const object = value;
        const type = String(object.type ?? "").toLowerCase();
        if (type === "testdone" || type === "test_done" || type === "testresult") {
            total += 1;
            const result = String(object.result ?? object.status ?? object.outcome ?? "").toLowerCase();
            if (object.skipped === true || ["skipped", "skip"].includes(result))
                skipped += 1;
            else if (["success", "passed", "pass"].includes(result))
                passed += 1;
            else
                failed += 1;
        }
        for (const nested of Object.values(object)) {
            if (nested && typeof nested === "object")
                visit(nested);
        }
    };
    for (const event of parseMachineEvents(output))
        visit(event);
    return { passed, failed, skipped, total };
}
function latestHumanTestCounts(output) {
    // `flutter test` progress lines look like `00:01 +12 -2 ~1: test name`.
    // Capture the final progress counter as it is more reliable than a summary
    // sentence (which is not printed consistently across Flutter versions).
    const matches = [...output.matchAll(/(?:^|\r?\n)\s*[\d:.]+\s+\+(\d+)(?:\s+-(\d+))?(?:\s+~(\d+))?\s*:/g)];
    const latest = matches.at(-1);
    if (!latest)
        return { passed: null, failed: null, skipped: null };
    return {
        passed: Number(latest[1]),
        failed: latest[2] === undefined ? 0 : Number(latest[2]),
        skipped: latest[3] === undefined ? 0 : Number(latest[3]),
    };
}
/** Parse Flutter's human and --machine output into a stable result object. */
export function parseFlutterTestOutput(result, command, cwd) {
    const combined = `${result.stdout}\n${result.stderr}`;
    const eventCounts = collectTestEventCounts(combined);
    const passedMatches = [...combined.matchAll(/\b(\d+)\s+tests?\s+passed\b/gi)].map((match) => Number(match[1]));
    const failedMatches = [...combined.matchAll(/\b(\d+)\s+tests?\s+failed\b/gi)].map((match) => Number(match[1]));
    const skippedMatches = [...combined.matchAll(/\b(\d+)\s+tests?\s+skipped\b/gi)].map((match) => Number(match[1]));
    const humanCounts = latestHumanTestCounts(combined);
    const passCount = eventCounts.total > 0 ? eventCounts.passed : passedMatches.at(-1) ?? humanCounts.passed ?? (result.code === 0 ? null : 0);
    const failCount = eventCounts.total > 0 ? eventCounts.failed : failedMatches.at(-1) ?? humanCounts.failed ?? (result.code === 0 ? 0 : null);
    const skippedCount = eventCounts.total > 0 ? eventCounts.skipped : skippedMatches.at(-1) ?? humanCounts.skipped;
    const testCount = eventCounts.total > 0
        ? eventCounts.total
        : passCount !== null && failCount !== null
            ? passCount + failCount + (skippedCount ?? 0)
            : null;
    // A command that exits zero without executing any test must not look like a
    // successful QA run (for example, an empty directory or an over-broad
    // filter). Keep this explicit so an agent can distinguish it from a normal
    // pass with a parsed count.
    const noTestsDetected = testCount === 0
        || (testCount === null && passCount === null && failCount === null && !result.timedOut && !result.spawnError);
    const allTestsSkipped = testCount !== null
        && testCount > 0
        && passCount === 0
        && failCount === 0
        && skippedCount === testCount;
    const lines = combined.split(/\r?\n/);
    const overflowLines = lines
        .map((text, index) => ({ text, lineNumber: index + 1 }))
        .filter(({ text }) => /RenderFlex overflowed by .*?pixels|A RenderFlex overflowed|overflowed by \d+(?:\.\d+)? pixels/i.test(text))
        .slice(0, 100);
    const stackTrace = lines
        .filter((line) => /^\s*#\d+\s+/.test(line) || /(?:^|[\\/])[^\\/\s]+\.dart:\d+(?::\d+)?/.test(line) || /^\s*(?:[A-Za-z]+Exception|[A-Za-z]+Error):/.test(line))
        .slice(0, 100);
    const baseStatus = result.spawnError
        ? "spawn_error"
        : result.timedOut
            ? "timed_out"
            : result.code === 0 && !noTestsDetected && !allTestsSkipped && (failCount === null || failCount === 0)
                ? "passed"
                : "failed";
    const overflowDetected = overflowLines.length > 0;
    // Flutter can report a RenderFlex overflow while still exiting zero. Treat
    // that as a failed QA run so callers cannot accidentally accept a broken
    // responsive layout.
    const status = baseStatus === "passed" && overflowDetected
        ? "failed"
        : baseStatus;
    return {
        ok: status === "passed",
        status,
        command,
        cwd,
        exitCode: result.code,
        signal: result.signal,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        passCount,
        failCount,
        skippedCount,
        testCount,
        noTestsDetected,
        allTestsSkipped,
        overflowDetected,
        overflowLines,
        stackTrace,
        stdout: compactText(result.stdout),
        stderr: compactText(result.stderr),
        outputTruncated: result.truncated,
        ...(result.spawnError ? { spawnError: result.spawnError } : {}),
    };
}
function normalizeSeverity(value) {
    const severity = String(value ?? "").toLowerCase();
    if (severity.includes("error") || severity === "failure")
        return "error";
    if (severity.includes("warning") || severity === "warn")
        return "warning";
    if (severity.includes("info") || severity.includes("hint") || severity === "notice")
        return "info";
    return null;
}
function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function issueFromObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const raw = value;
    const candidate = raw.issue && typeof raw.issue === "object" ? raw.issue : raw;
    const severity = normalizeSeverity(candidate.severity ?? raw.severity ?? candidate.level ?? raw.level);
    const location = (candidate.location ?? raw.location);
    const range = location && typeof location.range === "object" ? location.range : undefined;
    const start = (range?.start ?? location?.start);
    const fileValue = location?.file ?? location?.path ?? candidate.file ?? raw.file;
    const messageValue = candidate.problemMessage ?? candidate.message ?? raw.problemMessage ?? raw.message;
    if (!severity || typeof messageValue !== "string")
        return null;
    const file = typeof fileValue === "string" ? fileValue : null;
    const line = numberOrNull(start?.line ?? location?.line ?? candidate.line ?? raw.line);
    const column = numberOrNull(start?.column ?? location?.column ?? candidate.column ?? raw.column);
    const end = (range?.end ?? location?.end);
    const endColumn = numberOrNull(end?.column);
    return {
        severity,
        code: typeof (candidate.code ?? raw.code) === "string" ? String(candidate.code ?? raw.code) : null,
        message: messageValue,
        correction: typeof (candidate.correctionMessage ?? candidate.correction ?? raw.correctionMessage) === "string"
            ? String(candidate.correctionMessage ?? candidate.correction ?? raw.correctionMessage)
            : null,
        file,
        line,
        column,
        length: line !== null && column !== null && endColumn !== null ? Math.max(0, endColumn - column) : null,
        url: typeof (candidate.url ?? raw.url) === "string" ? String(candidate.url ?? raw.url) : null,
    };
}
function parseAnalyzerPipeLine(line) {
    const fields = line.split("|");
    if (fields.length < 6)
        return null;
    const severity = normalizeSeverity(fields[0]);
    if (!severity)
        return null;
    // Dart's machine format is generally
    // SEVERITY|TYPE|CODE|FILE|LINE|COLUMN|LENGTH|MESSAGE|CORRECTION.
    // A few Flutter versions omit fields or prefix the file with a URI, so use
    // the extension as an anchor and fall back to the legacy numeric scan.
    const fileIndex = fields.findIndex((field) => /\.(dart|yaml|json|arb)$/i.test(field));
    const afterFile = fileIndex >= 0 ? fields.slice(fileIndex + 1) : [];
    const lineNumber = Number(afterFile[0]);
    const columnNumber = Number(afterFile[1]);
    const lengthNumber = Number(afterFile[2]);
    const numeric = fields
        .map((field, index) => ({ index, value: Number(field) }))
        .filter(({ value }) => Number.isInteger(value) && value >= 0);
    const message = (afterFile.length >= 4 ? afterFile[3] : fields.at(-2) ?? fields.at(-1))?.trim();
    if (!message)
        return null;
    return {
        severity,
        code: fields[2]?.trim() || (fields.find((field) => /^[a-z][a-z0-9_]+$/i.test(field) && !/^(error|warning|info)$/i.test(field)) ?? null),
        message,
        correction: afterFile.length >= 5 && afterFile[4].trim() ? afterFile[4].trim() : null,
        file: fileIndex >= 0 ? fields[fileIndex] : null,
        line: Number.isInteger(lineNumber) && lineNumber >= 0 ? lineNumber : numeric[0]?.value ?? null,
        column: Number.isInteger(columnNumber) && columnNumber >= 0 ? columnNumber : numeric[1]?.value ?? null,
        length: Number.isInteger(lengthNumber) && lengthNumber >= 0 ? lengthNumber : null,
        url: null,
    };
}
function parseAnalyzerHumanLine(line) {
    const bullet = line.match(/^(error|warning|info|hint)\s+•\s+(.+?)\s+•\s+(.+?):(\d+):(\d+)(?:\s+•\s+([^\s]+))?\s*$/i);
    if (bullet) {
        return {
            severity: normalizeSeverity(bullet[1]),
            code: bullet[6] ?? null,
            message: bullet[2].trim(),
            correction: null,
            file: bullet[3],
            line: Number(bullet[4]),
            column: Number(bullet[5]),
            length: null,
            url: null,
        };
    }
    const match = line.match(/^(.+):(\d+):(\d+):\s*(.*)$/);
    if (!match)
        return null;
    const detail = match[4].trim();
    const severityMatch = detail.match(/^\[(error|warning|info|hint)\]\s*/i);
    const severity = normalizeSeverity(severityMatch?.[1] ?? detail.match(/\b(error|warning|info|hint)\b/i)?.[1]);
    if (!severity)
        return null;
    return {
        severity,
        code: null,
        message: severityMatch ? detail.slice(severityMatch[0].length) : detail,
        correction: null,
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        length: null,
        url: null,
    };
}
export function sanitizeAnalyzerFile(file) {
    if (!file)
        return null;
    let normalized = file;
    if (/^file:/i.test(file)) {
        try {
            // Analyzer machine output may use a file:// URI. Convert it with the
            // platform-aware URL helper before comparing it with the project root.
            normalized = fileURLToPath(new URL(file));
        }
        catch {
            normalized = file.replace(/^file:\/\//i, "");
        }
    }
    const looksWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(normalized);
    if (path.isAbsolute(normalized) || looksWindowsAbsolute) {
        const resolved = path.resolve(normalized);
        return isWithinProject(resolved) ? projectRelativePath(resolved) : "[external-file]";
    }
    return normalized.replaceAll("\\", "/");
}
/** Parse analyzer JSON-lines, pipe machine output and legacy text output. */
export function parseAnalyzerOutput(stdout, stderr = "") {
    const issues = [];
    const add = (issue) => {
        if (!issue)
            return;
        const key = [issue.severity, issue.file, issue.line, issue.column, issue.code, issue.message].join("\u0001");
        if (!issues.some((existing) => [existing.severity, existing.file, existing.line, existing.column, existing.code, existing.message].join("\u0001") === key)) {
            issues.push(issue);
        }
    };
    const combined = `${stdout}\n${stderr}`;
    for (const event of parseMachineEvents(combined)) {
        add(issueFromObject(event));
        if (event && typeof event === "object" && !Array.isArray(event)) {
            const object = event;
            for (const nested of [object.issue, object.error, object.warning, object.issues, object.diagnostics]) {
                if (Array.isArray(nested)) {
                    for (const item of nested)
                        add(issueFromObject(item));
                }
                else {
                    add(issueFromObject(nested));
                }
            }
        }
    }
    for (const line of combined.split(/\r?\n/)) {
        add(parseAnalyzerPipeLine(line));
        add(parseAnalyzerHumanLine(line));
    }
    return issues;
}
async function handleRunFlutterTests(rawArgs) {
    const args = asRecord(rawArgs);
    const cwd = await resolveCwd(args);
    const testPathInput = optionalString(args, "testPath")
        ?? optionalString(args, "file")
        ?? optionalString(args, "filePath")
        ?? optionalString(args, "path");
    const timeoutMs = timeoutFrom(args);
    const commandArgs = ["test"];
    let target;
    if (testPathInput) {
        target = await safeProjectPath(testPathInput, "testPath");
        commandArgs.push(relativeCommandPath(target, cwd));
    }
    if (args.name !== undefined) {
        const name = optionalString(args, "name");
        if (name)
            commandArgs.push("--name", name);
    }
    if (args.coverage === true)
        commandArgs.push("--coverage");
    if (args.failFast === true)
        commandArgs.push("--fail-fast");
    if (args.machine === true)
        commandArgs.push("--machine");
    commandArgs.push(...stringArray(args, "extraArgs"));
    const spec = spawnSpec("flutter", commandArgs);
    const result = await runCommand(spec.command, spec.args, { cwd, timeoutMs, windowsVerbatimArguments: spec.windowsVerbatimArguments });
    return {
        ...parseFlutterTestOutput(result, commandForAgent(spec.display), cwd),
        cwd: projectRelativePath(cwd),
    };
}
async function handleAnalyzeCode(rawArgs) {
    const args = asRecord(rawArgs);
    const cwd = await resolveCwd(args);
    const timeoutMs = timeoutFrom(args);
    const commandArgs = ["analyze"];
    const format = args.format === "text" ? "text" : "machine";
    if (format === "machine")
        commandArgs.push("--machine");
    const paths = stringArray(args, "paths");
    const singlePath = optionalString(args, "path");
    if (singlePath)
        paths.push(singlePath);
    for (const input of paths)
        commandArgs.push(relativeCommandPath(await safeProjectPath(input, "paths"), cwd));
    commandArgs.push(...stringArray(args, "extraArgs"));
    const spec = spawnSpec("flutter", commandArgs);
    const result = await runCommand(spec.command, spec.args, { cwd, timeoutMs, windowsVerbatimArguments: spec.windowsVerbatimArguments });
    const issues = parseAnalyzerOutput(result.stdout, result.stderr).map((issue) => ({
        ...issue,
        file: sanitizeAnalyzerFile(issue.file),
    }));
    const counts = {
        errors: issues.filter((issue) => issue.severity === "error").length,
        warnings: issues.filter((issue) => issue.severity === "warning").length,
        infos: issues.filter((issue) => issue.severity === "info").length,
    };
    return {
        ok: result.code === 0 && !result.timedOut && !result.spawnError && counts.errors === 0,
        status: result.spawnError
            ? "spawn_error"
            : result.timedOut
                ? "timed_out"
                : result.code === 0 && counts.errors === 0
                    ? "passed"
                    : "failed",
        command: commandForAgent(spec.display),
        cwd: projectRelativePath(cwd),
        ...commandSummary(result),
        ...counts,
        issueCount: issues.length,
        issues,
        stdout: compactText(result.stdout),
        stderr: compactText(result.stderr),
    };
}
function isLoopbackHost(hostname) {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
function vmServiceUrl(raw, allowRemote) {
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new InputError("uri must be a valid Dart VM Service http(s) URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new InputError("uri must use http or https; provide the HTTP VM Service URI, not a raw websocket URI.");
    }
    if (parsed.username || parsed.password || parsed.hash) {
        throw new InputError("uri must not contain credentials or a URL fragment.");
    }
    if (!allowRemote && !isLoopbackHost(parsed.hostname)) {
        throw new InputError("uri must target localhost/127.0.0.1/::1 unless allowRemote is true.");
    }
    return parsed;
}
/** Keep the VM Service host/method useful while never returning its auth path. */
function redactedVmServiceUri(endpoint) {
    const safe = new URL(endpoint.toString());
    const authPath = safe.pathname.match(/^\/([^/]+)(.*)$/);
    if (authPath)
        safe.pathname = `/[redacted]${authPath[2]}`;
    // Query parameters can contain isolate IDs or application data; callers can
    // inspect the structured response without receiving the original URI.
    safe.search = "";
    return safe.toString();
}
function vmServiceParams(value) {
    if (value === undefined || value === null)
        return {};
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new InputError("params must be a JSON object of scalar values.");
    }
    const record = value;
    const entries = Object.entries(record);
    if (entries.length > 20)
        throw new InputError("params may contain at most 20 values.");
    const result = {};
    for (const [key, item] of entries) {
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(key)) {
            throw new InputError(`Invalid VM Service parameter name: ${key}`);
        }
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
            throw new InputError(`VM Service parameter ${key} must be a string, number or boolean.`);
        }
        result[key] = String(item);
    }
    return result;
}
function redactVmAuthPath(value, authPath, depth = 0) {
    if (depth > 12)
        return "[redacted: nesting limit]";
    const prefix = authPath.replace(/\/+$/, "");
    if (typeof value === "string") {
        if (!prefix || prefix === "/")
            return value;
        return value.replace(new RegExp(escapeRegExp(prefix), "g"), "/[redacted]");
    }
    if (Array.isArray(value))
        return value.map((item) => redactVmAuthPath(item, authPath, depth + 1));
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = redactVmAuthPath(item, authPath, depth + 1);
        }
        return result;
    }
    return value;
}
async function readResponseBody(response, maxBytes) {
    if (!response.body) {
        const text = await response.text();
        return { text: compactText(text, maxBytes), truncated: text.length > maxBytes };
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let truncated = false;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            const chunk = next.value;
            const remaining = maxBytes - total;
            if (remaining <= 0) {
                truncated = true;
                await reader.cancel();
                break;
            }
            const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
            chunks.push(accepted);
            total += accepted.byteLength;
            if (accepted.byteLength < chunk.byteLength) {
                truncated = true;
                await reader.cancel();
                break;
            }
        }
    }
    finally {
        reader.releaseLock();
    }
    return { text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"), truncated };
}
/**
 * Query a read-only Dart VM Service HTTP endpoint. Flutter prints a VM Service
 * URI when an app/test is launched with observatory support; pass that URI and
 * a protocol method such as getVM or getIsolate. The default loopback guard
 * prevents an agent from turning this tool into an arbitrary network client.
 */
async function handleVmService(rawArgs) {
    const args = asRecord(rawArgs);
    const rawUri = optionalString(args, "uri");
    if (!rawUri)
        throw new InputError("uri is required (for example http://127.0.0.1:8181/<token>/).");
    const method = optionalString(args, "method") ?? "getVM";
    if (!/^(?:get|lookup)[A-Za-z0-9_]{1,77}$/.test(method)) {
        throw new InputError("method must be a read-only Dart VM Service get*/lookup* method.");
    }
    const allowRemote = args.allowRemote === true;
    if (allowRemote && !ALLOW_REMOTE_VM_SERVICE) {
        throw new InputError("Remote VM Service access is disabled. Set FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1 and pass allowRemote=true only for an authorized endpoint.");
    }
    const base = vmServiceUrl(rawUri, allowRemote);
    const endpoint = new URL(base.toString());
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/${method}`;
    for (const [key, value] of Object.entries(vmServiceParams(args.params))) {
        endpoint.searchParams.set(key, value);
    }
    const timeoutMs = timeoutFrom(args);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
        if (typeof fetch !== "function") {
            return {
                ok: false,
                status: "error",
                uri: redactedVmServiceUri(endpoint),
                method,
                statusCode: null,
                durationMs: Date.now() - started,
                contentType: null,
                bodyTruncated: false,
                data: null,
                error: "This Node.js runtime does not provide fetch().",
            };
        }
        const response = await fetch(endpoint, {
            method: "GET",
            headers: { accept: "application/json" },
            redirect: "error",
            signal: controller.signal,
        });
        const body = await readResponseBody(response, MAX_RESPONSE_CHARS * 4);
        let data = body.text;
        try {
            data = body.text.length === 0 ? null : JSON.parse(body.text);
        }
        catch {
            // Some VM Service/proxy versions return plain text for an error; retain it.
        }
        data = redactVmAuthPath(data, base.pathname);
        return {
            ok: response.ok,
            status: response.ok ? "ok" : "http_error",
            uri: redactedVmServiceUri(endpoint),
            method,
            statusCode: response.status,
            durationMs: Date.now() - started,
            contentType: response.headers.get("content-type"),
            bodyTruncated: body.truncated,
            data,
        };
    }
    catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return {
            ok: false,
            status: aborted ? "timeout" : "error",
            uri: redactedVmServiceUri(endpoint),
            method,
            statusCode: null,
            durationMs: Date.now() - started,
            contentType: null,
            bodyTruncated: false,
            data: null,
            error: redactVmAuthPath(error instanceof Error ? error.message : String(error), base.pathname),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function walkDartFiles(root, maxFiles = 1_000) {
    const files = [];
    try {
        const rootStat = await fs.stat(root);
        if (rootStat.isFile())
            return root.toLowerCase().endsWith(".dart") ? [root] : [];
    }
    catch {
        return files;
    }
    const visit = async (directory) => {
        if (files.length >= maxFiles)
            return;
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= maxFiles)
                return;
            if (entry.name.startsWith(".") || entry.name === "build" || entry.name === ".dart_tool")
                continue;
            const full = path.join(directory, entry.name);
            if (entry.isDirectory())
                await visit(full);
            else if (entry.isFile() && entry.name.endsWith(".dart"))
                files.push(full);
        }
    };
    await visit(root);
    return files;
}
async function scanLayoutCode(scanRoot) {
    const findings = [];
    const files = await walkDartFiles(scanRoot);
    for (const file of files) {
        let source;
        try {
            source = await fs.readFile(file, "utf8");
        }
        catch {
            continue;
        }
        const lines = source.split(/\r?\n/);
        const hasText = /\bText\s*\(/.test(source);
        const hasFlexibleParent = /\b(?:Expanded|Flexible|Wrap|SingleChildScrollView|ListView)\s*\(/.test(source);
        lines.forEach((line, index) => {
            if (/\bRenderFlex\s+overflowed\b/i.test(line)) {
                findings.push({
                    severity: "error",
                    rule: "explicit-renderflex-overflow",
                    file: relativeCommandPath(file, PROJECT_ROOT),
                    line: index + 1,
                    message: "Source contains an explicit RenderFlex overflow diagnostic.",
                });
            }
            const flex = line.match(/\b(Row|Column|Flex)\s*\(/);
            if (flex && hasText && !hasFlexibleParent && !/mainAxisSize\s*:/.test(line)) {
                findings.push({
                    severity: "warning",
                    rule: "unbounded-flex-text",
                    file: relativeCommandPath(file, PROJECT_ROOT),
                    line: index + 1,
                    message: `${flex[1]} contains text without an obvious flexible/scrolling parent; verify narrow and large-text layouts.`,
                });
            }
            const hardcoded = line.match(/\b(?:width|height)\s*:\s*(\d{3,5})(?:\.\d+)?/);
            if (hardcoded && Number(hardcoded[1]) > 390) {
                findings.push({
                    severity: "warning",
                    rule: "large-hardcoded-dimension",
                    file: relativeCommandPath(file, PROJECT_ROOT),
                    line: index + 1,
                    message: `Hard-coded ${hardcoded[1]} logical pixels may not fit a 320px viewport.`,
                });
            }
        });
    }
    return findings.slice(0, 250);
}
function parseBreakpoints(value) {
    if (value === undefined || value === null)
        return DEFAULT_BREAKPOINTS;
    if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
        throw new InputError("breakpoints must contain 1 to 12 objects.");
    }
    return value.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
            throw new InputError(`breakpoints[${index}] must be an object.`);
        const record = item;
        const name = typeof record.name === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(record.name) ? record.name : `breakpoint-${index + 1}`;
        const width = boundedNumber(record.width, `breakpoints[${index}].width`, 390, 100, 5_000);
        const height = boundedNumber(record.height, `breakpoints[${index}].height`, 844, 100, 5_000);
        return { name, width: Math.round(width), height: Math.round(height) };
    });
}
function parseTextScales(value) {
    if (value === undefined || value === null)
        return [1, 1.5];
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0 || values.length > 6)
        throw new InputError("textScales must contain 1 to 6 values.");
    return values.map((item, index) => boundedNumber(item, `textScales[${index}]`, 1, 0.5, 4));
}
async function handleCheckLayoutOverflow(rawArgs) {
    const args = asRecord(rawArgs);
    const cwd = await resolveCwd(args);
    const modeValue = args.mode;
    const mode = modeValue === "runtime" || modeValue === "static" || modeValue === "both" ? modeValue : "both";
    const breakpoints = parseBreakpoints(args.breakpoints);
    const textScales = parseTextScales(args.textScales ?? args.textScale);
    const timeoutMs = timeoutFrom(args);
    const staticRoot = args.scanPath !== undefined
        ? await safeProjectPath(optionalString(args, "scanPath"), "scanPath")
        : await safeProjectPath("lib", "scanPath");
    const staticFindings = mode === "runtime" ? [] : await scanLayoutCode(staticRoot);
    const testPathInput = optionalString(args, "testPath")
        ?? optionalString(args, "file")
        ?? optionalString(args, "filePath")
        ?? optionalString(args, "testFile");
    const testTarget = testPathInput ? await safeProjectPath(testPathInput, "testPath") : undefined;
    const runtimeRuns = [];
    if (mode !== "static") {
        for (const breakpoint of breakpoints) {
            for (const textScale of textScales) {
                const commandArgs = ["test"];
                if (testTarget)
                    commandArgs.push(relativeCommandPath(testTarget, cwd));
                // The test harness can read these compile-time values and call
                // tester.binding.window.physicalSizeTestValue/textScaleFactor.
                commandArgs.push(`--dart-define=FLUTTER_TEST_WIDTH=${breakpoint.width}`, `--dart-define=FLUTTER_TEST_HEIGHT=${breakpoint.height}`, `--dart-define=FLUTTER_TEST_TEXT_SCALE=${textScale}`, `--dart-define=FLUTTER_TEST_TEXT_SCALE_FACTOR=${textScale}`, `--dart-define=FLUTTER_TEST_BREAKPOINT=${breakpoint.name}`);
                commandArgs.push(...stringArray(args, "extraArgs"));
                const spec = spawnSpec("flutter", commandArgs);
                const result = await runCommand(spec.command, spec.args, { cwd, timeoutMs, windowsVerbatimArguments: spec.windowsVerbatimArguments });
                const parsed = parseFlutterTestOutput(result, commandForAgent(spec.display), cwd);
                runtimeRuns.push({
                    breakpoint,
                    textScale,
                    ok: parsed.ok && !parsed.overflowDetected,
                    overflowDetected: parsed.overflowDetected,
                    overflowLines: parsed.overflowLines,
                    status: parsed.status,
                    passCount: parsed.passCount,
                    failCount: parsed.failCount,
                    testCount: parsed.testCount,
                    durationMs: parsed.durationMs,
                    exitCode: parsed.exitCode,
                    stdout: parsed.stdout,
                    stderr: parsed.stderr,
                    stackTrace: parsed.stackTrace,
                    outputTruncated: parsed.outputTruncated,
                    ...(parsed.spawnError ? { spawnError: parsed.spawnError } : {}),
                });
            }
        }
    }
    const runtimeOverflow = runtimeRuns.some((run) => run.overflowDetected === true);
    const runtimeFailed = runtimeRuns.some((run) => run.ok !== true);
    const staticOverflow = staticFindings.some((finding) => finding.severity === "error");
    const overallFailed = runtimeFailed || staticOverflow;
    return {
        ok: !overallFailed,
        status: runtimeRuns.length === 0 ? (staticOverflow ? "failed" : "static_only") : overallFailed ? "failed" : "passed",
        // Never expose the host's absolute filesystem path in an agent transcript.
        projectRoot: ".",
        cwd: projectRelativePath(cwd),
        mode,
        breakpoints,
        textScales,
        staticFindings,
        staticFindingCount: staticFindings.length,
        runtimeRuns,
        runtimeRunCount: runtimeRuns.length,
        overflowDetected: runtimeOverflow || staticOverflow,
    };
}
function deviceId(args) {
    const value = optionalString(args, "deviceId");
    if (value && !/^[A-Za-z0-9._:-]{1,100}$/.test(value))
        throw new InputError("deviceId contains unsupported characters.");
    return value;
}
function encodeAdbInputText(value) {
    if (value.length > 2_000)
        throw new InputError("text must be at most 2,000 characters.");
    // adb's input text uses %s for spaces. Percent-encode punctuation so the
    // device-side shell cannot reinterpret it as a second argument.
    return encodeURIComponent(value)
        .replace(/%20/g, "%s")
        .replace(/!/g, "%21")
        .replace(/'/g, "%27")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29")
        .replace(/\*/g, "%2A");
}
async function handleAdbCommand(rawArgs) {
    const args = asRecord(rawArgs);
    const operation = optionalString(args, "operation");
    if (!operation || !["devices", "get_state", "screencap", "tap", "input_text", "logcat_crash"].includes(operation)) {
        throw new InputError("operation must be one of devices, get_state, screencap, tap, input_text, logcat_crash.");
    }
    if ((operation === "tap" || operation === "input_text") && !ALLOW_ADB_MUTATIONS) {
        throw new InputError("ADB mutations are disabled. Set FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1 only when an authorized agent may tap or type on the connected device.");
    }
    const cwd = await resolveCwd(args);
    const timeoutMs = timeoutFrom(args);
    const selectedDevice = deviceId(args);
    const prefix = selectedDevice ? ["-s", selectedDevice] : [];
    let commandArgs;
    let outputPath;
    let maxOutputBytes = MAX_CAPTURE_BYTES;
    switch (operation) {
        case "devices":
            commandArgs = ["devices", "-l"];
            break;
        case "get_state":
            commandArgs = [...prefix, "get-state"];
            break;
        case "screencap": {
            commandArgs = [...prefix, "exec-out", "screencap", "-p"];
            const requested = optionalString(args, "outputPath") ?? path.join(".artifacts", `flutter-screenshot-${Date.now()}.png`);
            outputPath = await safeProjectPath(requested, "outputPath");
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            maxOutputBytes = 20 * 1024 * 1024;
            break;
        }
        case "tap": {
            const x = boundedInteger(args, "x", -1, 0, 20_000);
            const y = boundedInteger(args, "y", -1, 0, 20_000);
            if (x < 0 || y < 0)
                throw new InputError("tap requires non-negative integer x and y.");
            commandArgs = [...prefix, "shell", "input", "tap", String(x), String(y)];
            break;
        }
        case "input_text": {
            const text = optionalString(args, "text");
            if (text === undefined)
                throw new InputError("input_text requires text.");
            commandArgs = [...prefix, "shell", "input", "text", encodeAdbInputText(text)];
            break;
        }
        case "logcat_crash": {
            const lines = boundedInteger(args, "lines", 1_000, 1, 20_000);
            commandArgs = [...prefix, "logcat", "-d", "-v", "threadtime", "-t", String(lines), "*:E"];
            break;
        }
        default:
            throw new InputError("Unsupported ADB operation.");
    }
    const spec = spawnSpec("adb", commandArgs);
    const result = await runCommand(spec.command, spec.args, { cwd, timeoutMs, maxOutputBytes, windowsVerbatimArguments: spec.windowsVerbatimArguments });
    if (operation === "screencap") {
        const screenshotOk = result.code === 0
            && !result.timedOut
            && !result.spawnError
            && !result.truncated
            && result.stdoutBuffer.length > 0;
        if (screenshotOk && outputPath) {
            await fs.writeFile(outputPath, result.stdoutBuffer);
        }
        return {
            ok: screenshotOk,
            operation,
            command: commandForAgent(spec.display),
            cwd: projectRelativePath(cwd),
            ...commandSummary(result),
            outputPath: outputPath ? relativeCommandPath(outputPath, PROJECT_ROOT) : null,
            bytesWritten: result.code === 0 ? result.stdoutBuffer.length : 0,
            stderr: compactText(result.stderr),
        };
    }
    let filteredCrashLines;
    if (operation === "logcat_crash") {
        const packageFilter = optionalString(args, "package");
        const crashPattern = /FATAL EXCEPTION|AndroidRuntime|CRASH|SIGSEGV|SIGABRT|FlutterError|Unhandled Exception|E\/flutter/i;
        filteredCrashLines = result.stdout
            .split(/\r?\n/)
            .filter((line) => crashPattern.test(line) && (!packageFilter || line.includes(packageFilter)))
            .slice(-500);
    }
    return {
        ok: result.code === 0 && !result.timedOut && !result.spawnError,
        operation,
        command: commandForAgent(spec.display),
        cwd: projectRelativePath(cwd),
        ...commandSummary(result),
        stdout: compactText(result.stdout),
        stderr: compactText(result.stderr),
        ...(filteredCrashLines ? { crashLines: filteredCrashLines, crashDetected: filteredCrashLines.length > 0 } : {}),
    };
}
const IOS_JSON_OUTPUT_SENTINEL = "__FLUTTER_MCP_IOS_JSON_OUTPUT__";
function recordOrEmpty(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
        if (typeof value === "number" && Number.isFinite(value))
            return String(value);
    }
    return null;
}
function firstBoolean(...values) {
    for (const value of values)
        if (typeof value === "boolean")
            return value;
    return null;
}
function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
        return Number(value);
    return null;
}
function findValueByKeys(value, keys, depth = 0) {
    if (depth > 8 || value === null || typeof value !== "object")
        return undefined;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findValueByKeys(item, keys, depth + 1);
            if (found !== undefined)
                return found;
        }
        return undefined;
    }
    const record = value;
    for (const [key, item] of Object.entries(record)) {
        if (keys.has(key.toLowerCase()))
            return item;
    }
    for (const item of Object.values(record)) {
        const found = findValueByKeys(item, keys, depth + 1);
        if (found !== undefined)
            return found;
    }
    return undefined;
}
/** Normalize the stable, non-sensitive portion of devicectl's evolving JSON schema. */
export function parseDevicectlDevices(value) {
    const root = recordOrEmpty(value);
    const result = recordOrEmpty(root.result);
    const candidates = Array.isArray(result.devices)
        ? result.devices
        : Array.isArray(root.devices)
            ? root.devices
            : Array.isArray(value)
                ? value
                : [];
    const devices = [];
    for (const candidate of candidates) {
        const raw = recordOrEmpty(candidate);
        const properties = recordOrEmpty(raw.properties);
        const deviceProperties = recordOrEmpty(raw.deviceProperties);
        const hardwareProperties = recordOrEmpty(raw.hardwareProperties);
        const connectionProperties = recordOrEmpty(raw.connectionProperties);
        const identifier = firstString(raw.identifier, raw.id, properties.identifier, properties.id);
        if (!identifier)
            continue;
        const platform = firstString(raw.platform, properties.platform, hardwareProperties.platform, deviceProperties.platform);
        const deviceType = firstString(properties.deviceType, hardwareProperties.deviceType, properties.productType, hardwareProperties.productType);
        const looksIos = Boolean(platform?.toLowerCase().includes("ios")
            || platform?.toLowerCase().includes("iphone")
            || deviceType && /^(?:iphone|ipad)/i.test(deviceType));
        if (!looksIos)
            continue;
        const state = firstString(raw.state, properties.state, properties.bootState, deviceProperties.bootState, connectionProperties.tunnelState);
        const servicesAvailable = firstBoolean(properties.ddiServicesAvailable, deviceProperties.ddiServicesAvailable);
        const available = servicesAvailable !== false
            && !/unavailable|disconnected|shutdown|offline/i.test(state ?? "");
        devices.push({
            identifier,
            name: firstString(raw.name, properties.name, deviceProperties.name),
            platform,
            model: firstString(properties.marketingName, hardwareProperties.marketingName, properties.productType, hardwareProperties.productType),
            osVersion: firstString(properties.osVersionNumber, deviceProperties.osVersionNumber, properties.osVersion, deviceProperties.osVersion),
            state,
            transport: firstString(properties.transportType, connectionProperties.transportType, properties.connectionType),
            pairingState: firstString(properties.pairingState, connectionProperties.pairingState),
            developerModeStatus: firstString(properties.developerModeStatus, deviceProperties.developerModeStatus),
            available,
        });
    }
    return devices;
}
/** Parse the bounded summary emitted by Xcode 16+'s xcresulttool. */
export function parseXcresultSummary(value, maxFailures = 100) {
    const root = recordOrEmpty(value);
    const totalTestCount = numberValue(root.totalTestCount ?? root.testsCount ?? root.totalTests);
    const passedTests = numberValue(root.passedTests ?? root.passedTestCount);
    const failedTests = numberValue(root.failedTests ?? root.failedTestCount);
    const skippedTests = numberValue(root.skippedTests ?? root.skippedTestCount);
    const expectedFailures = numberValue(root.expectedFailures ?? root.expectedFailureCount);
    const result = firstString(root.result, root.status, root.outcome);
    const rawFailures = Array.isArray(root.testFailures)
        ? root.testFailures
        : Array.isArray(root.failures)
            ? root.failures
            : [];
    const failures = rawFailures.slice(0, Math.max(0, maxFailures)).map((item) => {
        const failure = recordOrEmpty(item);
        const location = recordOrEmpty(failure.sourceCodeContext ?? failure.location);
        const file = firstString(failure.fileName, failure.file, location.filePath, location.file);
        return {
            testName: firstString(failure.testName, failure.name, failure.identifier),
            targetName: firstString(failure.targetName, failure.target),
            failureText: compactText(redactIosDiagnostic(firstString(failure.failureText, failure.message, failure.description) ?? "XCUITest failed without a message."), 4_000),
            file: sanitizeAnalyzerFile(file),
            line: numberValue(failure.lineNumber ?? failure.line ?? location.lineNumber ?? location.line),
        };
    });
    const noTestsDetected = totalTestCount === null || totalTestCount === 0;
    const allTestsSkipped = totalTestCount !== null
        && totalTestCount > 0
        && skippedTests === totalTestCount
        && (passedTests ?? 0) === 0
        && (failedTests ?? 0) === 0;
    const resultPassed = /^(?:pass|passed|success|succeeded)$/i.test(result ?? "");
    return {
        ok: resultPassed && !noTestsDetected && !allTestsSkipped && failedTests === 0,
        result,
        totalTestCount,
        passedTests,
        failedTests,
        skippedTests,
        expectedFailures,
        durationSeconds: numberValue(root.totalTestDuration ?? root.duration ?? root.durationSeconds),
        noTestsDetected,
        allTestsSkipped,
        failures,
    };
}
function collectXcresultTests(value, maxTests) {
    const tests = [];
    const seen = new Set();
    const visit = (node, depth = 0) => {
        if (tests.length >= maxTests || depth > 20 || node === null || typeof node !== "object")
            return;
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item, depth + 1);
            return;
        }
        const record = node;
        const name = firstString(record.testName, record.name, record.identifier);
        const result = firstString(record.result, record.status, record.outcome);
        if (name && result) {
            const key = `${name}\u0001${result}`;
            if (!seen.has(key)) {
                seen.add(key);
                tests.push({
                    name,
                    targetName: firstString(record.targetName, record.target),
                    result,
                    durationSeconds: numberValue(record.duration ?? record.durationSeconds),
                });
            }
        }
        for (const item of Object.values(record))
            visit(item, depth + 1);
    };
    visit(value);
    return tests;
}
function requireIosMutations(action) {
    if (!ALLOW_IOS_MUTATIONS) {
        throw new InputError(`iOS mutations are disabled for ${action}. Set FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1 only for an authorized device/test session, then restart the MCP server.`);
    }
}
function requiredIosDeviceId(args) {
    const value = deviceId(args);
    if (!value)
        throw new InputError("deviceId is required; choose an explicit identifier returned by list_ios_devices.");
    if (value.startsWith("-"))
        throw new InputError("deviceId must not start with a hyphen.");
    return value;
}
function safeToken(args, key, defaultValue, pattern, description) {
    const value = optionalString(args, key) ?? defaultValue;
    if (value !== undefined && (!pattern.test(value) || value.startsWith("-"))) {
        throw new InputError(`${key} ${description}.`);
    }
    return value;
}
function testIdentifierArray(args, key) {
    const values = stringArray(args, key);
    for (const value of values) {
        if (value.startsWith("-") || !/^[A-Za-z0-9_.:/()\-]{1,300}$/.test(value)) {
            throw new InputError(`${key} contains an invalid XCTest identifier.`);
        }
    }
    return values;
}
function dartDefines(value) {
    if (value === undefined || value === null)
        return [];
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new InputError("dartDefines must be a JSON object of scalar values.");
    }
    const entries = Object.entries(value);
    if (entries.length > 40)
        throw new InputError("dartDefines may contain at most 40 values.");
    return entries.map(([key, item]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,100}$/.test(key)) {
            throw new InputError(`Invalid dartDefines key: ${key}`);
        }
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
            throw new InputError(`dartDefines.${key} must be a string, number or boolean.`);
        }
        const rendered = String(item);
        if (rendered.length > 1_000 || /[\0\r\n]/.test(rendered)) {
            throw new InputError(`dartDefines.${key} is too long or contains a control character.`);
        }
        return [key, rendered];
    });
}
async function ensureExistingProjectPath(input, label, suffixes, expected = "either") {
    const resolved = await safeProjectPath(input, label);
    if (suffixes.length > 0 && !suffixes.some((suffix) => resolved.toLowerCase().endsWith(suffix))) {
        throw new InputError(`${label} must end with ${suffixes.join(" or ")}.`);
    }
    let stat;
    try {
        stat = await fs.stat(resolved);
    }
    catch {
        throw new InputError(`${label} does not exist: ${input}`);
    }
    if (expected === "file" && !stat.isFile())
        throw new InputError(`${label} must be a file.`);
    if (expected === "directory" && !stat.isDirectory())
        throw new InputError(`${label} must be a directory.`);
    return resolved;
}
async function createIosJsonSidecar(label) {
    const directory = await safeProjectPath(path.join(".artifacts", "flutter-mcp", "ios", "tmp"), "iOS temp directory");
    await fs.mkdir(directory, { recursive: true });
    await assertRealpathInsideProject(directory, "iOS temp directory");
    return path.join(directory, `${label}-${Date.now()}-${randomUUID()}.json`);
}
async function runXcrunJson(args, label, cwd, timeoutMs) {
    const jsonPath = await createIosJsonSidecar(label);
    const commandArgs = args.map((value) => value === IOS_JSON_OUTPUT_SENTINEL ? jsonPath : value);
    const spec = spawnSpec("xcrun", commandArgs);
    const result = await runCommand(spec.command, spec.args, {
        cwd,
        timeoutMs,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    let data = null;
    let parseError;
    try {
        const raw = await fs.readFile(jsonPath, "utf8");
        if (Buffer.byteLength(raw, "utf8") > MAX_CAPTURE_BYTES) {
            parseError = "devicectl JSON output exceeded the 5 MiB safety limit.";
        }
        else {
            try {
                data = JSON.parse(raw);
            }
            catch (error) {
                parseError = `devicectl returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
    }
    catch (error) {
        parseError = `devicectl did not create its JSON result: ${error instanceof Error ? error.message : String(error)}`;
    }
    finally {
        await fs.rm(jsonPath, { force: true }).catch(() => undefined);
    }
    return {
        command: commandForAgent(spec.display),
        result,
        data,
        ...(parseError ? { parseError } : {}),
    };
}
function devicectlOutcome(data) {
    return firstString(findValueByKeys(data, new Set(["outcome", "status", "resultstatus"])));
}
function devicectlSucceeded(command) {
    const outcome = devicectlOutcome(command.data);
    return command.result.code === 0
        && !command.result.timedOut
        && !command.result.spawnError
        && !command.parseError
        && !/fail|error|cancel/i.test(outcome ?? "");
}
function devicectlProcessId(data) {
    return numberValue(findValueByKeys(data, new Set([
        "processidentifier",
        "processid",
        "pid",
    ])));
}
async function handleListIosDevices(rawArgs) {
    assertIosHost();
    const args = asRecord(rawArgs);
    const cwd = await resolveCwd(args);
    const timeoutMs = timeoutFrom(args);
    const command = await runXcrunJson(["devicectl", "list", "devices", "--json-output", IOS_JSON_OUTPUT_SENTINEL], "list-devices", cwd, timeoutMs);
    const devices = command.parseError ? [] : parseDevicectlDevices(command.data);
    const ok = command.result.code === 0
        && !command.result.timedOut
        && !command.result.spawnError
        && !command.parseError;
    return {
        ok,
        status: command.result.spawnError
            ? "spawn_error"
            : command.result.timedOut
                ? "timed_out"
                : command.parseError
                    ? "parse_error"
                    : command.result.code === 0
                        ? "passed"
                        : "failed",
        command: command.command,
        cwd: projectRelativePath(cwd),
        ...commandSummary(command.result),
        deviceCount: devices.length,
        devices,
        ...(command.parseError ? { parseError: compactText(redactIosDiagnostic(command.parseError)) } : {}),
        stdout: compactText(redactIosDiagnostic(command.result.stdout)),
        stderr: compactText(redactIosDiagnostic(command.result.stderr)),
    };
}
async function handleIosAppControl(rawArgs) {
    assertIosHost();
    const args = asRecord(rawArgs);
    const operation = optionalString(args, "operation");
    if (!operation || !["install", "launch", "terminate"].includes(operation)) {
        throw new InputError("operation must be one of install, launch, terminate.");
    }
    requireIosMutations(`app ${operation}`);
    const cwd = await resolveCwd(args);
    const timeoutMs = timeoutFrom(args);
    const selectedDevice = requiredIosDeviceId(args);
    let commandArgs;
    let bundleId;
    if (operation === "install") {
        const appPathInput = optionalString(args, "appPath");
        if (!appPathInput)
            throw new InputError("install requires appPath.");
        const appPath = await ensureExistingProjectPath(appPathInput, "appPath", [".app"], "directory");
        commandArgs = [
            "devicectl", "device", "install", "app",
            "--device", selectedDevice,
            "--json-output", IOS_JSON_OUTPUT_SENTINEL,
            appPath,
        ];
    }
    else if (operation === "launch") {
        bundleId = safeToken(args, "bundleId", undefined, /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/, "must be a valid application bundle identifier");
        if (!bundleId)
            throw new InputError("launch requires bundleId.");
        commandArgs = [
            "devicectl", "device", "process", "launch",
            "--device", selectedDevice,
            ...(args.terminateExisting === true ? ["--terminate-existing"] : []),
            "--json-output", IOS_JSON_OUTPUT_SENTINEL,
            bundleId,
        ];
    }
    else {
        const pid = boundedInteger(args, "pid", -1, 1, 2_147_483_647);
        if (pid < 1)
            throw new InputError("terminate requires a positive integer pid returned by a prior launch operation.");
        commandArgs = [
            "devicectl", "device", "process", "terminate",
            "--device", selectedDevice,
            "--pid", String(pid),
            ...(args.kill === true ? ["--kill"] : []),
            "--json-output", IOS_JSON_OUTPUT_SENTINEL,
        ];
    }
    const command = await runXcrunJson(commandArgs, `app-${operation}`, cwd, timeoutMs);
    const ok = devicectlSucceeded(command);
    const secrets = [selectedDevice, ...(bundleId ? [bundleId] : [])];
    return {
        ok,
        status: command.result.spawnError
            ? "spawn_error"
            : command.result.timedOut
                ? "timed_out"
                : command.parseError
                    ? "parse_error"
                    : ok
                        ? "passed"
                        : "failed",
        operation,
        command: command.command.map((value) => secrets.includes(value) ? "<redacted>" : value),
        cwd: projectRelativePath(cwd),
        ...commandSummary(command.result),
        outcome: devicectlOutcome(command.data),
        processId: devicectlProcessId(command.data),
        ...(command.parseError ? { parseError: compactText(redactIosDiagnostic(command.parseError)) } : {}),
        stdout: compactText(redactIosDiagnostic(command.result.stdout, secrets)),
        stderr: compactText(redactIosDiagnostic(command.result.stderr, secrets)),
    };
}
async function handleRunIosIntegrationTests(rawArgs) {
    assertIosHost();
    const args = asRecord(rawArgs);
    requireIosMutations("integration testing");
    const cwd = await resolveCwd(args);
    const selectedDevice = requiredIosDeviceId(args);
    const testPathInput = optionalString(args, "testPath");
    if (!testPathInput)
        throw new InputError("testPath is required.");
    const testTarget = await ensureExistingProjectPath(testPathInput, "testPath", [".dart"], "file");
    const projectRelativeTarget = projectRelativePath(testTarget);
    if (!projectRelativeTarget.split("/").includes("integration_test")) {
        throw new InputError("testPath must point to a Dart file inside integration_test/.");
    }
    const timeoutMs = timeoutFrom(args);
    const commandArgs = ["test", relativeCommandPath(testTarget, cwd), "-d", selectedDevice];
    const flavor = safeToken(args, "flavor", undefined, /^[A-Za-z0-9_.-]{1,100}$/, "contains unsupported characters");
    if (flavor)
        commandArgs.push("--flavor", flavor);
    const name = optionalString(args, "name");
    if (name) {
        if (name.length > 300 || /[\0\r\n]/.test(name))
            throw new InputError("name is too long or contains a control character.");
        commandArgs.push("--name", name);
    }
    if (args.failFast === true)
        commandArgs.push("--fail-fast");
    if (args.machine === true)
        commandArgs.push("--machine");
    const defines = dartDefines(args.dartDefines);
    for (const [key, value] of defines)
        commandArgs.push(`--dart-define=${key}=${value}`);
    const spec = spawnSpec("flutter", commandArgs);
    const result = await runCommand(spec.command, spec.args, {
        cwd,
        timeoutMs,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    const parsed = parseFlutterTestOutput(result, commandForAgent(spec.display), cwd);
    const secrets = [selectedDevice, ...defines.map(([, value]) => value)];
    return {
        ...parsed,
        platform: "ios",
        // The command already proves that an explicit device was selected. Keep
        // its identifier out of agent transcripts and public CI artifacts.
        deviceId: "<selected-device>",
        cwd: projectRelativePath(cwd),
        overflowLines: parsed.overflowLines.map((line) => ({
            ...line,
            text: redactIosDiagnostic(line.text, secrets),
        })),
        stackTrace: parsed.stackTrace.map((line) => redactIosDiagnostic(line, secrets)),
        stdout: compactText(redactIosDiagnostic(parsed.stdout, secrets)),
        stderr: compactText(redactIosDiagnostic(parsed.stderr, secrets)),
    };
}
async function runXcresultTool(resultBundlePath, view, cwd, timeoutMs) {
    const spec = spawnSpec("xcrun", [
        "xcresulttool", "get", "test-results", view,
        "--path", resultBundlePath,
        "--compact",
    ]);
    const result = await runCommand(spec.command, spec.args, {
        cwd,
        timeoutMs,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    let data = null;
    let parseError;
    if (result.code === 0 && !result.timedOut && !result.spawnError) {
        try {
            data = JSON.parse(result.stdout);
        }
        catch (error) {
            parseError = `xcresulttool returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    return {
        command: commandForAgent(spec.display),
        result,
        data,
        ...(parseError ? { parseError } : {}),
    };
}
async function inspectXcresultBundle(resultBundlePath, cwd, timeoutMs, includeTests, maxTests) {
    const summaryRun = await runXcresultTool(resultBundlePath, "summary", cwd, timeoutMs);
    const summary = summaryRun.parseError || summaryRun.result.code !== 0
        ? null
        : parseXcresultSummary(summaryRun.data);
    let tests = [];
    let testsRun;
    if (includeTests && summary !== null) {
        testsRun = await runXcresultTool(resultBundlePath, "tests", cwd, timeoutMs);
        if (!testsRun.parseError && testsRun.result.code === 0) {
            tests = collectXcresultTests(testsRun.data, maxTests);
        }
    }
    const ok = summaryRun.result.code === 0
        && !summaryRun.result.timedOut
        && !summaryRun.result.spawnError
        && !summaryRun.parseError
        && summary?.ok === true
        && (!testsRun || (testsRun.result.code === 0 && !testsRun.parseError));
    return {
        ok,
        status: summaryRun.result.spawnError
            ? "spawn_error"
            : summaryRun.result.timedOut
                ? "timed_out"
                : summaryRun.parseError || testsRun?.parseError
                    ? "parse_error"
                    : ok
                        ? "passed"
                        : "failed",
        resultBundlePath: projectRelativePath(resultBundlePath),
        command: summaryRun.command,
        ...commandSummary(summaryRun.result),
        summary,
        tests,
        testListTruncated: tests.length >= maxTests,
        ...(summaryRun.parseError ? { parseError: compactText(summaryRun.parseError) } : {}),
        ...(testsRun?.parseError ? { testListParseError: compactText(testsRun.parseError) } : {}),
        stderr: compactText(redactIosDiagnostic(summaryRun.result.stderr)),
        ...(testsRun ? {
            testListCommand: testsRun.command,
            testListCommandResult: commandSummary(testsRun.result),
            testListStderr: compactText(redactIosDiagnostic(testsRun.result.stderr)),
        } : {}),
    };
}
async function handleInspectXcresult(rawArgs) {
    assertIosHost();
    const args = asRecord(rawArgs);
    const cwd = await resolveCwd(args);
    const input = optionalString(args, "resultBundlePath");
    if (!input)
        throw new InputError("resultBundlePath is required.");
    const bundle = await ensureExistingProjectPath(input, "resultBundlePath", [".xcresult"], "directory");
    const includeTests = args.includeTests !== false;
    const maxTests = boundedInteger(args, "maxTests", 200, 1, 500);
    return inspectXcresultBundle(bundle, cwd, timeoutFrom(args), includeTests, maxTests);
}
async function defaultXcodeContainer() {
    const workspace = await safeProjectPath(path.join("ios", "Runner.xcworkspace"), "workspace");
    try {
        if ((await fs.stat(workspace)).isDirectory())
            return { type: "workspace", path: workspace };
    }
    catch {
        // Try the generated project below.
    }
    const project = await safeProjectPath(path.join("ios", "Runner.xcodeproj"), "project");
    try {
        if ((await fs.stat(project)).isDirectory())
            return { type: "project", path: project };
    }
    catch {
        // Report one actionable error below.
    }
    throw new InputError("No Xcode container was supplied and ios/Runner.xcworkspace or ios/Runner.xcodeproj was not found.");
}
async function handleRunXcuitests(rawArgs) {
    assertIosHost();
    const args = asRecord(rawArgs);
    requireIosMutations("XCUITest execution");
    const cwd = await resolveCwd(args);
    const selectedDevice = requiredIosDeviceId(args);
    const workspaceInput = optionalString(args, "workspace");
    const projectInput = optionalString(args, "project");
    if (workspaceInput && projectInput)
        throw new InputError("Provide exactly one of workspace or project, not both.");
    const container = workspaceInput
        ? { type: "workspace", path: await ensureExistingProjectPath(workspaceInput, "workspace", [".xcworkspace"], "directory") }
        : projectInput
            ? { type: "project", path: await ensureExistingProjectPath(projectInput, "project", [".xcodeproj"], "directory") }
            : await defaultXcodeContainer();
    const scheme = safeToken(args, "scheme", "Runner", /^[A-Za-z0-9_.][A-Za-z0-9_. -]{0,99}$/, "contains unsupported characters");
    const configuration = safeToken(args, "configuration", "Debug", /^[A-Za-z0-9_.][A-Za-z0-9_. -]{0,99}$/, "contains unsupported characters");
    const testPlan = safeToken(args, "testPlan", undefined, /^[A-Za-z0-9_.][A-Za-z0-9_. -]{0,99}$/, "contains unsupported characters");
    const onlyTesting = testIdentifierArray(args, "onlyTesting");
    const skipTesting = testIdentifierArray(args, "skipTesting");
    const destinationTimeoutSeconds = boundedInteger(args, "destinationTimeoutSeconds", 60, 1, 300);
    const timeoutMs = timeoutFrom(args);
    const includeTests = args.includeTests !== false;
    const maxTests = boundedInteger(args, "maxTests", 200, 1, 500);
    const resultInput = optionalString(args, "resultBundlePath")
        ?? path.join(".artifacts", "ios-tests", `${Date.now()}-${randomUUID()}.xcresult`);
    const resultBundlePath = await safeProjectPath(resultInput, "resultBundlePath");
    if (!resultBundlePath.toLowerCase().endsWith(".xcresult")) {
        throw new InputError("resultBundlePath must end with .xcresult.");
    }
    try {
        await fs.stat(resultBundlePath);
        throw new InputError("resultBundlePath already exists; choose a new path so evidence is never overwritten.");
    }
    catch (error) {
        if (error instanceof InputError)
            throw error;
        if (error.code !== "ENOENT")
            throw error;
    }
    await fs.mkdir(path.dirname(resultBundlePath), { recursive: true });
    await assertRealpathInsideProject(path.dirname(resultBundlePath), "resultBundlePath");
    const derivedInput = optionalString(args, "derivedDataPath")
        ?? path.join(".artifacts", "ios-derived-data", randomUUID());
    const derivedDataPath = await safeProjectPath(derivedInput, "derivedDataPath");
    await fs.mkdir(path.dirname(derivedDataPath), { recursive: true });
    await assertRealpathInsideProject(path.dirname(derivedDataPath), "derivedDataPath");
    const commandArgs = [
        "xcodebuild", "test",
        container.type === "workspace" ? "-workspace" : "-project", container.path,
        "-scheme", scheme,
        "-configuration", configuration,
        "-destination", `platform=iOS,id=${selectedDevice}`,
        "-destination-timeout", String(destinationTimeoutSeconds),
        "-parallel-testing-enabled", "NO",
        "-resultBundlePath", resultBundlePath,
        "-derivedDataPath", derivedDataPath,
        ...(testPlan ? ["-testPlan", testPlan] : []),
        ...onlyTesting.map((identifier) => `-only-testing:${identifier}`),
        ...skipTesting.map((identifier) => `-skip-testing:${identifier}`),
    ];
    const spec = spawnSpec("xcrun", commandArgs);
    const result = await runCommand(spec.command, spec.args, {
        cwd,
        timeoutMs,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    let inspection = null;
    try {
        const stat = await fs.stat(resultBundlePath);
        if (stat.isDirectory()) {
            inspection = await inspectXcresultBundle(resultBundlePath, cwd, Math.min(timeoutMs, 120_000), includeTests, maxTests);
        }
    }
    catch {
        // The command result below reports the missing evidence bundle.
    }
    const ok = result.code === 0
        && !result.timedOut
        && !result.spawnError
        && inspection?.ok === true;
    return {
        ok,
        status: result.spawnError
            ? "spawn_error"
            : result.timedOut
                ? "timed_out"
                : inspection === null
                    ? "xcresult_missing"
                    : ok
                        ? "passed"
                        : "failed",
        platform: "ios",
        command: commandForAgent(spec.display),
        cwd: projectRelativePath(cwd),
        ...commandSummary(result),
        resultBundlePath: projectRelativePath(resultBundlePath),
        derivedDataPath: projectRelativePath(derivedDataPath),
        inspection,
        stdout: compactText(redactIosDiagnostic(result.stdout, [selectedDevice])),
        stderr: compactText(redactIosDiagnostic(result.stderr, [selectedDevice])),
    };
}
const TOOL_DEFINITIONS = [
    {
        name: "run_flutter_tests",
        description: "Run Flutter tests for a file or the whole project and return pass/fail counts, stack traces and RenderFlex overflow lines.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            type: "object",
            properties: {
                testPath: { type: "string", description: "Project-relative test file or directory." },
                file: { type: "string", description: "Alias for testPath." },
                filePath: { type: "string", description: "Alias for testPath." },
                path: { type: "string", description: "Alias for testPath." },
                cwd: { type: "string", description: "Project-relative working directory." },
                name: { type: "string", description: "Optional Flutter test name filter." },
                coverage: { type: "boolean" },
                failFast: { type: "boolean" },
                machine: { type: "boolean", description: "Also pass --machine to flutter test." },
                extraArgs: { type: "array", items: { type: "string" } },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "analyze_code",
        description: "Run flutter analyze and normalize analyzer diagnostics into structured JSON.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            type: "object",
            properties: {
                cwd: { type: "string" },
                paths: { type: "array", items: { type: "string" }, description: "Optional project-relative paths." },
                path: { type: "string", description: "Alias for one analyzed path." },
                format: { type: "string", enum: ["machine", "text"], default: "machine" },
                extraArgs: { type: "array", items: { type: "string" } },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "query_vm_service",
        description: "Query a read-only Dart VM Service HTTP method such as getVM or getIsolate; loopback URIs are required by default.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        inputSchema: {
            type: "object",
            required: ["uri"],
            properties: {
                uri: { type: "string", description: "HTTP VM Service URI printed by Flutter (including its auth path)." },
                method: { type: "string", default: "getVM" },
                params: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
                allowRemote: { type: "boolean", default: false, description: "Request a non-loopback VM Service host; also requires FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1." },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "check_layout_overflow",
        description: "Run widget tests across small, standard and landscape viewports (including 1.5x text scale) and scan Dart layout code for overflow risks.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            type: "object",
            properties: {
                testPath: { type: "string" },
                file: { type: "string" },
                filePath: { type: "string" },
                testFile: { type: "string" },
                cwd: { type: "string" },
                mode: { type: "string", enum: ["runtime", "static", "both"], default: "both" },
                scanPath: { type: "string", default: "lib" },
                breakpoints: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: { name: { type: "string" }, width: { type: "number" }, height: { type: "number" } },
                        required: ["width", "height"],
                        additionalProperties: false,
                    },
                },
                textScales: { type: "array", items: { type: "number" }, default: [1, 1.5] },
                textScale: { type: "number", description: "Alias for one text scale." },
                extraArgs: { type: "array", items: { type: "string" } },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "run_adb_command",
        description: "Run a whitelisted ADB operation. tap/input_text are device-mutating and require FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1; screencap/logcat may contain sensitive data.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        inputSchema: {
            type: "object",
            required: ["operation"],
            properties: {
                operation: { type: "string", enum: ["devices", "get_state", "screencap", "tap", "input_text", "logcat_crash"] },
                deviceId: { type: "string" },
                cwd: { type: "string" },
                outputPath: { type: "string", description: "Project-relative PNG path for screencap." },
                x: { type: "integer", minimum: 0, maximum: 20000 },
                y: { type: "integer", minimum: 0, maximum: 20000 },
                text: { type: "string" },
                package: { type: "string" },
                lines: { type: "integer", minimum: 1, maximum: 20000 },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "list_ios_devices",
        description: "List connected physical iPhone/iPad devices through Xcode devicectl and return a bounded, normalized device summary.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        inputSchema: {
            type: "object",
            properties: {
                cwd: { type: "string", description: "Project-relative working directory." },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "run_ios_integration_tests",
        description: "Build, sign, install and run a checked-in Flutter integration_test on one explicitly selected physical iOS device.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        inputSchema: {
            type: "object",
            required: ["testPath", "deviceId"],
            properties: {
                testPath: { type: "string", description: "Project-relative Dart test below integration_test/." },
                deviceId: { type: "string", description: "Exact identifier returned by list_ios_devices." },
                cwd: { type: "string", description: "Project-relative working directory." },
                flavor: { type: "string" },
                name: { type: "string", description: "Optional Flutter test name filter." },
                failFast: { type: "boolean" },
                machine: { type: "boolean" },
                dartDefines: {
                    type: "object",
                    maxProperties: 40,
                    additionalProperties: { type: ["string", "number", "boolean"] },
                },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "run_xcuitests",
        description: "Run a checked-in XCTest/XCUITest target on one physical iOS device and fail closed unless the generated xcresult contains non-empty passing tests.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        inputSchema: {
            type: "object",
            required: ["deviceId"],
            properties: {
                deviceId: { type: "string", description: "Exact identifier returned by list_ios_devices." },
                cwd: { type: "string", description: "Project-relative working directory." },
                workspace: { type: "string", description: "Project-relative .xcworkspace path; mutually exclusive with project." },
                project: { type: "string", description: "Project-relative .xcodeproj path; mutually exclusive with workspace." },
                scheme: { type: "string", default: "Runner" },
                configuration: { type: "string", default: "Debug" },
                testPlan: { type: "string" },
                onlyTesting: { type: "array", maxItems: 40, items: { type: "string" } },
                skipTesting: { type: "array", maxItems: 40, items: { type: "string" } },
                resultBundlePath: { type: "string", description: "New project-relative .xcresult path; existing evidence is never overwritten." },
                derivedDataPath: { type: "string", description: "Project-relative DerivedData directory." },
                destinationTimeoutSeconds: { type: "integer", minimum: 1, maximum: 300, default: 60 },
                includeTests: { type: "boolean", default: true },
                maxTests: { type: "integer", minimum: 1, maximum: 500, default: 200 },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "ios_app_control",
        description: "Install, launch or terminate an app on an explicitly selected physical iOS device through an allow-listed devicectl operation.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        inputSchema: {
            type: "object",
            required: ["operation", "deviceId"],
            properties: {
                operation: { type: "string", enum: ["install", "launch", "terminate"] },
                deviceId: { type: "string", description: "Exact identifier returned by list_ios_devices." },
                cwd: { type: "string", description: "Project-relative working directory." },
                appPath: { type: "string", description: "Project-relative, signed .app directory for install." },
                bundleId: { type: "string", description: "Application bundle identifier for launch." },
                terminateExisting: { type: "boolean", description: "Ask devicectl to terminate an existing instance before launch." },
                pid: { type: "integer", minimum: 1, maximum: 2147483647, description: "Process ID returned by launch; required for terminate." },
                kill: { type: "boolean", description: "Use devicectl's force-kill option for terminate." },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
    {
        name: "inspect_xcresult",
        description: "Read and normalize an existing project-contained .xcresult bundle with Xcode 16+ xcresulttool.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            type: "object",
            required: ["resultBundlePath"],
            properties: {
                resultBundlePath: { type: "string", description: "Existing project-relative .xcresult directory." },
                cwd: { type: "string", description: "Project-relative working directory." },
                includeTests: { type: "boolean", default: true },
                maxTests: { type: "integer", minimum: 1, maximum: 500, default: 200 },
                timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
            },
            additionalProperties: false,
        },
    },
];
export async function createServer() {
    const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const name = request.params.name;
        try {
            switch (name) {
                case "run_flutter_tests":
                    return toolResult(await handleRunFlutterTests(request.params.arguments ?? {}));
                case "analyze_code":
                    return toolResult(await handleAnalyzeCode(request.params.arguments ?? {}));
                case "query_vm_service":
                    return toolResult(await handleVmService(request.params.arguments ?? {}));
                case "check_layout_overflow":
                    return toolResult(await handleCheckLayoutOverflow(request.params.arguments ?? {}));
                case "run_adb_command":
                    return toolResult(await handleAdbCommand(request.params.arguments ?? {}));
                case "list_ios_devices":
                    return toolResult(await handleListIosDevices(request.params.arguments ?? {}));
                case "run_ios_integration_tests":
                    return toolResult(await handleRunIosIntegrationTests(request.params.arguments ?? {}));
                case "run_xcuitests":
                    return toolResult(await handleRunXcuitests(request.params.arguments ?? {}));
                case "ios_app_control":
                    return toolResult(await handleIosAppControl(request.params.arguments ?? {}));
                case "inspect_xcresult":
                    return toolResult(await handleInspectXcresult(request.params.arguments ?? {}));
                default:
                    return toolResult({ ok: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } }, true);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const code = error instanceof ToolError ? error.code : "TOOL_EXECUTION_ERROR";
            return toolResult({ ok: false, error: { code, message } }, true);
        }
    });
    return server;
}
export async function main() {
    const server = await createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
const invokedDirectly = process.argv[1]
    ? path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
    : false;
if (invokedDirectly) {
    main().catch((error) => {
        // Never write diagnostics to stdout: stdout is reserved for MCP JSON-RPC.
        console.error(`[${SERVER_NAME}] fatal:`, error);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=index.js.map