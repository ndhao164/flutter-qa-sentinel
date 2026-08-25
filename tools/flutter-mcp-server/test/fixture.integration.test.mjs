import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..", "..", "..");
const fixtureRoot = path.join(repositoryRoot, "examples", "flutter_fixture");
const serverEntry = path.join(repositoryRoot, "tools", "flutter-mcp-server", "dist", "index.js");

await access(path.join(fixtureRoot, "pubspec.yaml"));
await access(serverEntry);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  cwd: repositoryRoot,
  env: {
    ...process.env,
    FLUTTER_PROJECT_ROOT: fixtureRoot,
    FLUTTER_MCP_TIMEOUT_MS: "120000",
    FLUTTER_MCP_ALLOW_ADB_MUTATIONS: "0",
    FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE: "0",
  },
  stderr: "pipe",
});
const client = new Client(
  { name: "flutter-qa-fixture-integration", version: "1.0.0" },
  { capabilities: {} },
);

try {
  await client.connect(transport);

  const analysis = await client.callTool({ name: "analyze_code", arguments: {} });
  assert.equal(analysis.isError, undefined);
  assert.equal(analysis.structuredContent?.ok, true);
  assert.equal(analysis.structuredContent?.errors, 0);

  const tests = await client.callTool({
    name: "run_flutter_tests",
    arguments: { testPath: "test/fixture_test.dart" },
  });
  assert.equal(tests.isError, undefined);
  assert.equal(tests.structuredContent?.ok, true);
  assert.equal(tests.structuredContent?.overflowDetected, false);
  assert.ok((tests.structuredContent?.passCount ?? 0) >= 2);

  const layout = await client.callTool({
    name: "check_layout_overflow",
    arguments: {
      mode: "both",
      scanPath: "lib",
      testPath: "test/fixture_test.dart",
      timeoutMs: 120_000,
    },
  }, undefined, { timeout: 300_000, maxTotalTimeout: 300_000 });
  assert.equal(layout.isError, undefined);
  assert.equal(layout.structuredContent?.ok, true);
  assert.equal(layout.structuredContent?.overflowDetected, false);

  console.log("Flutter MCP fixture integration passed.");
} finally {
  await transport.close();
}
