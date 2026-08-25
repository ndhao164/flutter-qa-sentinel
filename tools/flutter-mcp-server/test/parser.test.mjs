import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandForAgent,
  parseAnalyzerOutput,
  parseFlutterTestOutput,
  sanitizeAnalyzerFile,
} from "../dist/index.js";

test("analyzer parser normalizes machine JSON and keeps structured locations", () => {
  const issues = parseAnalyzerOutput(JSON.stringify({
    issue: {
      severity: "ERROR",
      code: "invalid_assignment",
      problemMessage: "A value cannot be assigned here.",
      location: {
        file: "lib/features/example.dart",
        range: {
          start: { line: 4, column: 2 },
          end: { line: 4, column: 8 },
        },
      },
    },
  }));

  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    severity: "error",
    code: "invalid_assignment",
    message: "A value cannot be assigned here.",
    correction: null,
    file: "lib/features/example.dart",
    line: 4,
    column: 2,
    length: 6,
    url: null,
  });
});

test("analyzer file URI is converted before project-relative redaction", () => {
  const local = sanitizeAnalyzerFile("file:///E:/skill/tools/flutter-mcp-server/src/index.ts");
  assert.equal(local, "src/index.ts");
  assert.equal(sanitizeAnalyzerFile("file:///outside/project.dart"), "[external-file]");
});

test("Flutter test parser treats an overflow marker as a failed QA result", () => {
  const parsed = parseFlutterTestOutput({
    code: 0,
    signal: null,
    stdout: "00:00 +1: renders\nA RenderFlex overflowed by 12 pixels on the right.",
    stderr: "",
    timedOut: false,
    truncated: false,
    durationMs: 12,
  }, ["flutter", "test"], "E:/skill/examples/flutter_fixture");

  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, "failed");
  assert.equal(parsed.overflowDetected, true);
  assert.equal(parsed.overflowLines.length, 1);
  assert.equal(parsed.passCount, 1);
});

test("agent command echoes hide defines and ADB input text", () => {
  assert.deepEqual(commandForAgent([
    "C:\\Users\\qa\\flutter.bat",
    "test",
    "--dart-define=API_KEY=do-not-log",
  ]), ["flutter.bat", "test", "--dart-define=<redacted>"]);
  assert.deepEqual(commandForAgent([
    "adb.exe",
    "shell",
    "input",
    "text",
    "sensitive%stext",
  ]), ["adb.exe", "shell", "input", "text", "<redacted-input-text>"]);
});

test("an empty Flutter test run is not reported as a QA pass", () => {
  const parsed = parseFlutterTestOutput({
    code: 0,
    signal: null,
    stdout: "00:00 +0: loading test/no_tests.dart\n00:00 +0: All tests passed!",
    stderr: "",
    timedOut: false,
    truncated: false,
    durationMs: 3,
  }, ["flutter", "test"], "E:/skill/examples/flutter_fixture");

  assert.equal(parsed.noTestsDetected, true);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, "failed");
});

test("a run where every test is skipped is not reported as a QA pass", () => {
  const parsed = parseFlutterTestOutput({
    code: 0,
    signal: null,
    stdout: "00:00 +0 ~2: all tests skipped",
    stderr: "",
    timedOut: false,
    truncated: false,
    durationMs: 3,
  }, ["flutter", "test"], "E:/skill/examples/flutter_fixture");

  assert.equal(parsed.allTestsSkipped, true);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, "failed");
});
