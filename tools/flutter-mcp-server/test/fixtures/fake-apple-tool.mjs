import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [kind, ...args] = process.argv.slice(2);
const logPath = process.env.FAKE_APPLE_TOOL_LOG;
if (logPath) {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify({ kind, args })}\n`, "utf8");
}

const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const writeJsonSidecar = async (payload) => {
  const outputPath = optionValue("--json-output");
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload), "utf8");
};

if (kind === "flutter") {
  process.stdout.write("00:00 +1: iOS integration happy path\n00:00 +1: All tests passed!\n");
  process.exit(0);
}

if (kind !== "xcrun") {
  process.stderr.write(`Unknown fake tool kind: ${kind}\n`);
  process.exit(64);
}

if (args[0] === "devicectl" && args[1] === "list" && args[2] === "devices") {
  await writeJsonSidecar({
    info: { outcome: "success" },
    result: {
      devices: [
        {
          identifier: "00008110-001234567890801E",
          name: "QA iPhone",
          deviceProperties: {
            name: "QA iPhone",
            osVersionNumber: "18.4",
            pairingState: "paired",
          },
          hardwareProperties: {
            marketingName: "iPhone 15",
            platform: "iOS",
          },
          connectionProperties: {
            transportType: "wired",
            tunnelState: "connected",
          },
          properties: {
            name: "QA iPhone",
            osVersionNumber: "18.4",
            platform: "iOS",
            pairingState: "paired",
          },
        },
      ],
    },
  });
  process.stdout.write("device list written\n");
  process.exit(0);
}

if (args[0] === "devicectl" && args.includes("install")) {
  await writeJsonSidecar({ info: { outcome: "success" }, result: { installedApplications: [{ bundleIdentifier: "com.example.app" }] } });
  process.stdout.write("application installed\n");
  process.exit(0);
}

if (args[0] === "devicectl" && args.includes("launch")) {
  await writeJsonSidecar({ info: { outcome: "success" }, result: { process: { processIdentifier: 4321 } } });
  process.stdout.write("application launched\n");
  process.exit(0);
}

if (args[0] === "devicectl" && args.includes("terminate")) {
  await writeJsonSidecar({ info: { outcome: "success" }, result: { terminatedProcess: { processIdentifier: 4321 } } });
  process.stdout.write("process terminated\n");
  process.exit(0);
}

if (args[0] === "xcodebuild") {
  const resultBundlePath = optionValue("-resultBundlePath");
  if (resultBundlePath && process.env.FAKE_XCRESULT_MODE !== "missing") {
    await mkdir(resultBundlePath, { recursive: true });
  }
  process.stdout.write("Test Suite 'All tests' passed\n** TEST SUCCEEDED **\n");
  process.exit(0);
}

if (args[0] === "xcresulttool" && args.includes("summary")) {
  const empty = process.env.FAKE_XCRESULT_MODE === "empty";
  process.stdout.write(JSON.stringify({
    result: "Passed",
    totalTestCount: empty ? 0 : 2,
    passedTests: empty ? 0 : 2,
    failedTests: 0,
    skippedTests: 0,
    expectedFailures: 0,
    testFailures: [],
    diagnostics: [`project=${process.env.FLUTTER_PROJECT_ROOT}`, `tool=${process.env.XCRUN_BIN}`],
  }));
  process.exit(0);
}

if (args[0] === "xcresulttool" && args.includes("tests")) {
  process.stdout.write(JSON.stringify({
    testNodes: [
      { name: "testLogin", nodeType: "Test Case", result: "Passed", duration: "0.14s" },
      { name: "testLogout", nodeType: "Test Case", result: "Passed", duration: "0.09s" },
    ],
  }));
  process.exit(0);
}

process.stderr.write(`Unsupported fake xcrun invocation: ${JSON.stringify(args)}\n`);
process.exit(64);
