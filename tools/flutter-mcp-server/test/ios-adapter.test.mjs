import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDevicectlDevices, parseXcresultSummary } from "../dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const serverEntry = path.join(serverRoot, "dist", "index.js");
const fixtureRoot = path.join(here, "fixtures");
const protocolVersion = "2025-06-18";
const deviceId = "00008110-001234567890801E";

class McpProcess {
  constructor(projectRoot, env = {}) {
    this.child = spawn(process.execPath, [serverEntry], {
      cwd: serverRoot,
      env: { ...process.env, FLUTTER_PROJECT_ROOT: projectRoot, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.on("error", (error) => this.#rejectAll(error));
    this.child.on("close", (code, signal) => {
      this.#rejectAll(new Error(`MCP server exited (code=${code}, signal=${signal})\n${this.stderr}`));
    });
  }

  #onStdout(chunk) {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch (error) {
        this.#rejectAll(new Error(`Invalid JSON-RPC output: ${line}\n${error.message}`));
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) continue;
      this.pending.delete(message.id);
      waiter.resolve(message);
    }
  }

  #rejectAll(error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  request(id, method, params = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 15_000);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (message) => { clearTimeout(timer); resolve(message); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    await this.request(1, "initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "flutter-mcp-ios-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
  }

  async call(id, name, args) {
    return this.request(id, "tools/call", { name, arguments: args });
  }

  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => { this.child.kill(); resolve(); }, 1_000);
      timer.unref?.();
      this.child.once("close", resolve);
    });
  }
}

async function makeProject() {
  const root = await mkdtemp(path.join(serverRoot, ".ios-adapter-test-"));
  await mkdir(path.join(root, "integration_test"), { recursive: true });
  await mkdir(path.join(root, "ios", "Runner.xcworkspace"), { recursive: true });
  await mkdir(path.join(root, "build", "Runner.app"), { recursive: true });
  await writeFile(path.join(root, "integration_test", "app_test.dart"), "void main() {}\n", "utf8");
  return root;
}

async function fakeEnvironment(projectRoot, logPath, mutations = false) {
  const windows = process.platform === "win32";
  const xcrun = path.join(fixtureRoot, windows ? "fake-xcrun.cmd" : "fake-xcrun.sh");
  const flutter = path.join(fixtureRoot, windows ? "fake-flutter.cmd" : "fake-flutter.sh");
  if (!windows) await Promise.all([chmod(xcrun, 0o755), chmod(flutter, 0o755)]);
  return {
    NODE_ENV: "test",
    FLUTTER_MCP_TEST_ALLOW_IOS_TOOLS: "1",
    XCRUN_BIN: xcrun,
    FLUTTER_BIN: flutter,
    FAKE_APPLE_TOOL_LOG: logPath,
    ...(mutations ? { FLUTTER_MCP_ALLOW_IOS_MUTATIONS: "1" } : {}),
  };
}

function structured(response) {
  return response.result?.structuredContent;
}

function assertInputError(response, pattern) {
  assert.equal(response.result?.isError, true);
  assert.equal(structured(response)?.ok, false);
  assert.equal(structured(response)?.error?.code, "INVALID_INPUT");
  assert.match(structured(response)?.error?.message ?? "", pattern);
}

async function readLog(logPath) {
  try {
    return (await readFile(logPath, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("advertises the five iOS adapter tools with honest safety annotations", async (t) => {
  await access(serverEntry);
  const project = await makeProject();
  const log = path.join(project, "commands.jsonl");
  const server = new McpProcess(project, await fakeEnvironment(project, log));
  t.after(async () => { await server.close(); await rm(project, { recursive: true, force: true }); });
  await server.initialize();

  const listed = await server.request(2, "tools/list");
  const tools = new Map(listed.result.tools.map((tool) => [tool.name, tool]));
  for (const name of ["list_ios_devices", "run_ios_integration_tests", "run_xcuitests", "ios_app_control", "inspect_xcresult"]) {
    assert.ok(tools.has(name), `${name} is advertised`);
  }
  assert.equal(tools.get("list_ios_devices").annotations.readOnlyHint, true);
  assert.equal(tools.get("inspect_xcresult").annotations.readOnlyHint, true);
  for (const name of ["run_ios_integration_tests", "run_xcuitests", "ios_app_control"]) {
    assert.equal(tools.get(name).annotations.readOnlyHint, false);
    assert.equal(tools.get(name).annotations.destructiveHint, true);
  }
});

test("iOS parsers tolerate Xcode schema drift and reject zero-test false greens", () => {
  const devices = parseDevicectlDevices({
    result: {
      devices: [{
        identifier: deviceId,
        properties: {
          name: "Future iPhone",
          platform: "iOS",
          marketingName: "iPhone",
          osVersionNumber: "27.0",
          pairingState: "paired",
          ddiServicesAvailable: true,
        },
        _deprecationNotice: "fixture for the Xcode 27 flattened properties schema",
      }],
    },
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].identifier, deviceId);
  assert.equal(devices[0].available, true);

  const empty = parseXcresultSummary({
    result: "Passed",
    totalTestCount: 0,
    passedTests: 0,
    failedTests: 0,
    skippedTests: 0,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.noTestsDetected, true);

  const failed = parseXcresultSummary({
    result: "Failed",
    totalTestCount: 1,
    passedTests: 0,
    failedTests: 1,
    skippedTests: 0,
    testFailures: [{ testName: "LoginTests/testLogin", failureText: "Expected login screen" }],
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.failures.length, 1);
});

test("iOS mutations are blocked before any child command is spawned", async (t) => {
  const project = await makeProject();
  const log = path.join(project, "commands.jsonl");
  const server = new McpProcess(project, await fakeEnvironment(project, log));
  t.after(async () => { await server.close(); await rm(project, { recursive: true, force: true }); });
  await server.initialize();

  const calls = [
    ["run_ios_integration_tests", { deviceId, testPath: "integration_test/app_test.dart" }],
    ["run_xcuitests", { deviceId, workspace: "ios/Runner.xcworkspace", scheme: "Runner" }],
    ["ios_app_control", { operation: "launch", deviceId, bundleId: "com.example.app" }],
  ];
  let id = 2;
  for (const [name, args] of calls) {
    assertInputError(await server.call(id++, name, args), /disabled/i);
  }
  assert.deepEqual(await readLog(log), []);
});

test("iOS paths cannot traverse the project root", async (t) => {
  const project = await makeProject();
  const log = path.join(project, "commands.jsonl");
  const server = new McpProcess(project, await fakeEnvironment(project, log, true));
  t.after(async () => { await server.close(); await rm(project, { recursive: true, force: true }); });
  await server.initialize();

  const calls = [
    ["run_ios_integration_tests", { deviceId, testPath: "../../outside_test.dart" }],
    ["run_xcuitests", { deviceId, workspace: "../../Runner.xcworkspace" }],
    ["ios_app_control", { operation: "install", deviceId, appPath: "../../Runner.app" }],
    ["inspect_xcresult", { resultBundlePath: "../../Tests.xcresult" }],
  ];
  let id = 2;
  for (const [name, args] of calls) {
    assertInputError(await server.call(id++, name, args), /inside.*project root|stay inside/i);
  }
  assert.deepEqual(await readLog(log), []);
});

test("fake devicectl and Flutter runners validate parsing, redaction, and argument arrays", async (t) => {
  const project = await makeProject();
  const log = path.join(project, "commands.jsonl");
  const server = new McpProcess(project, await fakeEnvironment(project, log, true));
  t.after(async () => { await server.close(); await rm(project, { recursive: true, force: true }); });
  await server.initialize();

  const devices = structured(await server.call(2, "list_ios_devices", {}));
  assert.equal(devices?.ok, true);
  assert.equal(devices?.devices?.length, 1);
  assert.equal(devices?.devices?.[0]?.identifier, deviceId);
  assert.equal(devices?.devices?.[0]?.name, "QA iPhone");

  const integration = structured(await server.call(3, "run_ios_integration_tests", {
    deviceId,
    testPath: "integration_test/app_test.dart",
  }));
  assert.equal(integration?.ok, true);
  assert.equal(integration?.passCount, 1);
  assert.equal(integration?.deviceId, "<selected-device>");
  assert.doesNotMatch(JSON.stringify(integration?.command), new RegExp(deviceId, "i"));

  const launch = structured(await server.call(4, "ios_app_control", {
    operation: "launch",
    deviceId,
    bundleId: "com.example.app",
    terminateExisting: true,
  }));
  assert.equal(launch?.ok, true);
  assert.doesNotMatch(JSON.stringify(launch?.command), new RegExp(deviceId, "i"));
  assert.doesNotMatch(JSON.stringify(launch?.command), /com\.example\.app/i);

  const install = structured(await server.call(5, "ios_app_control", {
    operation: "install",
    deviceId,
    appPath: "build/Runner.app",
  }));
  assert.equal(install?.ok, true);

  const terminate = structured(await server.call(6, "ios_app_control", {
    operation: "terminate",
    deviceId,
    pid: 4321,
  }));
  assert.equal(terminate?.ok, true);

  const serialized = JSON.stringify({ devices, integration, launch, install, terminate });
  assert.doesNotMatch(serialized, new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(serialized, new RegExp(fixtureRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const invocations = await readLog(log);
  const list = invocations.find((entry) => entry.args.slice(0, 3).join(" ") === "devicectl list devices");
  assert.ok(list);
  assert.ok(list.args.includes("--json-output"));
  const flutter = invocations.find((entry) => entry.kind === "flutter");
  assert.deepEqual(flutter.args.slice(0, 2), ["test", "integration_test/app_test.dart"]);
  const launched = invocations.find((entry) => entry.args.includes("launch"));
  assert.ok(launched.args.includes(deviceId));
  assert.ok(launched.args.includes("com.example.app"));
  const installed = invocations.find((entry) => entry.args.includes("install"));
  assert.ok(installed.args.includes(deviceId));
  assert.ok(installed.args.some((arg) => /Runner\.app$/i.test(arg)));
  const terminated = invocations.find((entry) => entry.args.includes("terminate"));
  assert.ok(terminated.args.includes("--pid"));
  assert.ok(terminated.args.includes("4321"));
});

test("XCUITest uses structured selectors and xcresult inspection rejects false-green results", async (t) => {
  const project = await makeProject();
  const log = path.join(project, "commands.jsonl");
  const resultBundlePath = "artifacts/ui-tests.xcresult";
  const server = new McpProcess(project, await fakeEnvironment(project, log, true));
  t.after(async () => { await server.close(); await rm(project, { recursive: true, force: true }); });
  await server.initialize();

  const run = structured(await server.call(2, "run_xcuitests", {
    deviceId,
    workspace: "ios/Runner.xcworkspace",
    scheme: "Runner",
    onlyTesting: ["RunnerUITests/LoginTests/testHappyPath"],
    skipTesting: ["RunnerUITests/FlakyTests/testKnownIssue"],
    resultBundlePath,
    derivedDataPath: "artifacts/DerivedData",
  }));
  assert.equal(run?.ok, true);

  const inspected = structured(await server.call(3, "inspect_xcresult", {
    resultBundlePath,
    includeTests: true,
  }));
  assert.equal(inspected?.ok, true);
  assert.equal(inspected?.summary?.totalTestCount ?? inspected?.totalTestCount, 2);
  assert.equal(inspected?.summary?.failedTests ?? inspected?.failedTests, 0);
  assert.doesNotMatch(JSON.stringify(inspected), new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const invocations = await readLog(log);
  const xcodebuild = invocations.find((entry) => entry.args[0] === "xcodebuild");
  assert.ok(xcodebuild);
  assert.ok(xcodebuild.args.includes(`platform=iOS,id=${deviceId}`));
  assert.ok(xcodebuild.args.includes("-only-testing:RunnerUITests/LoginTests/testHappyPath"));
  assert.ok(xcodebuild.args.includes("-skip-testing:RunnerUITests/FlakyTests/testKnownIssue"));
  assert.ok(invocations.some((entry) => entry.args[0] === "xcresulttool" && entry.args.includes("summary")));
  assert.ok(invocations.some((entry) => entry.args[0] === "xcresulttool" && entry.args.includes("tests")));

  assertInputError(await server.call(4, "run_xcuitests", {
    deviceId,
    workspace: "ios/Runner.xcworkspace",
    onlyTesting: ["-resultBundlePath"],
  }), /onlyTesting|unsupported|must not start/i);
});

test("run_xcuitests fails closed when xcresult reports zero executed tests", async (t) => {
  const project = await makeProject();
  const log = path.join(project, "commands.jsonl");
  const env = {
    ...await fakeEnvironment(project, log, true),
    FAKE_XCRESULT_MODE: "empty",
  };
  const server = new McpProcess(project, env);
  t.after(async () => { await server.close(); await rm(project, { recursive: true, force: true }); });
  await server.initialize();

  const run = structured(await server.call(2, "run_xcuitests", {
    deviceId,
    workspace: "ios/Runner.xcworkspace",
    onlyTesting: ["RunnerUITests/LoginTests/testHappyPath"],
    resultBundlePath: "artifacts/empty.xcresult",
  }));
  assert.equal(run?.ok, false);
  assert.equal(run?.status, "failed");
  assert.equal(run?.inspection?.summary?.noTestsDetected, true);
});
