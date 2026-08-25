import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const serverEntry = path.join(serverRoot, "dist", "index.js");
const protocolVersion = "2025-06-18";

class McpProcess {
  constructor(env = {}) {
    this.child = spawn(process.execPath, [serverEntry], {
      cwd: serverRoot,
      env: {
        ...process.env,
        FLUTTER_PROJECT_ROOT: serverRoot,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("error", (error) => this.#rejectAll(error));
    this.child.on("close", (code, signal) => {
      this.#rejectAll(new Error(`MCP server exited before responding (code=${code}, signal=${signal})\n${this.stderr}`));
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
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.#rejectAll(new Error(`Invalid JSON-RPC line: ${line}\n${error.message}`));
        return;
      }
      if (message.id === undefined || message.id === null) continue;
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
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 1_000);
      timer.unref?.();
      this.child.once("close", resolve);
    });
  }
}

test("MCP server initializes and advertises all Flutter QA tools", async (t) => {
  await access(serverEntry);
  const server = new McpProcess();
  t.after(() => server.close());

  const initialized = await server.request(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flutter-mcp-smoke", version: "1.0.0" },
  });
  assert.equal(initialized.jsonrpc, "2.0");
  assert.equal(initialized.result?.serverInfo?.name, "flutter-mcp-server");
  assert.ok(initialized.result?.capabilities?.tools);
  server.notify("notifications/initialized");

  const listed = await server.request(2, "tools/list");
  const tools = listed.result?.tools;
  assert.ok(Array.isArray(tools));
  const names = tools.map((tool) => tool.name);
  const requiredTools = [
    "run_flutter_tests",
    "analyze_code",
    "query_vm_service",
    "check_layout_overflow",
    "run_adb_command",
  ];
  for (const requiredTool of requiredTools) assert.ok(names.includes(requiredTool), `${requiredTool} is advertised`);
  assert.equal(new Set(names).size, names.length, "tool names are unique");
  for (const tool of tools) {
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} has an input schema`);
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean");
  }
});

test("MCP tool rejects project-path traversal before spawning Flutter", async (t) => {
  const server = new McpProcess();
  t.after(() => server.close());
  await server.request(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flutter-mcp-smoke", version: "1.0.0" },
  });
  server.notify("notifications/initialized");

  const response = await server.request(2, "tools/call", {
    name: "run_flutter_tests",
    arguments: { testPath: "../../outside-project" },
  });
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.result?.isError, true);
  assert.equal(response.result?.structuredContent?.ok, false);
  assert.equal(response.result?.structuredContent?.error?.code, "INVALID_INPUT");
  assert.match(response.result?.structuredContent?.error?.message ?? "", /inside.*project root/i);
});

test("VM Service calls stay read-only and redact the auth path", async (t) => {
  const httpServer = createHttpServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ type: "VM", method: request.url }));
  });
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => httpServer.close());
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");

  const server = new McpProcess();
  t.after(() => server.close());
  await server.request(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flutter-mcp-smoke", version: "1.0.0" },
  });
  server.notify("notifications/initialized");
  const response = await server.request(2, "tools/call", {
    name: "query_vm_service",
    arguments: {
      // Flutter may print the VM Service URI with or without a trailing slash.
      uri: `http://127.0.0.1:${address.port}/secret-auth-token`,
      method: "getVM",
      timeoutMs: 2_000,
    },
  });
  const result = response.result?.structuredContent;
  assert.equal(result?.ok, true);
  assert.equal(result?.data?.type, "VM");
  assert.doesNotMatch(result?.uri ?? "", /secret-auth-token/);
  assert.doesNotMatch(JSON.stringify(result), /secret-auth-token/);
  assert.match(result?.uri ?? "", /\[redacted\]/);
});

test("ADB mutations require explicit environment opt-in", async (t) => {
  const server = new McpProcess();
  t.after(() => server.close());
  await server.request(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flutter-mcp-smoke", version: "1.0.0" },
  });
  server.notify("notifications/initialized");
  const response = await server.request(2, "tools/call", {
    name: "run_adb_command",
    arguments: { operation: "tap", x: 10, y: 20 },
  });
  assert.equal(response.result?.isError, true);
  assert.equal(response.result?.structuredContent?.error?.code, "INVALID_INPUT");
  assert.match(response.result?.structuredContent?.error?.message ?? "", /mutations are disabled/i);
});

test("remote VM Service access requires environment opt-in", async (t) => {
  const server = new McpProcess();
  t.after(() => server.close());
  await server.request(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flutter-mcp-smoke", version: "1.0.0" },
  });
  server.notify("notifications/initialized");
  const response = await server.request(2, "tools/call", {
    name: "query_vm_service",
    arguments: {
      uri: "http://203.0.113.10:8181/auth-token/",
      method: "getVM",
      allowRemote: true,
    },
  });
  assert.equal(response.result?.isError, true);
  assert.equal(response.result?.structuredContent?.error?.code, "INVALID_INPUT");
  assert.match(response.result?.structuredContent?.error?.message ?? "", /remote VM Service access is disabled/i);
});

test("layout responses do not expose the host absolute project path", async (t) => {
  const server = new McpProcess();
  t.after(() => server.close());
  await server.request(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flutter-mcp-smoke", version: "1.0.0" },
  });
  server.notify("notifications/initialized");
  const response = await server.request(2, "tools/call", {
    name: "check_layout_overflow",
    arguments: { mode: "static", scanPath: "." },
  });
  const result = response.result?.structuredContent;
  assert.equal(result?.ok, true);
  assert.equal(result?.projectRoot, ".");
  assert.equal(result?.cwd, ".");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(serverRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("toolchain command echoes redact configured absolute executable paths", async (t) => {
  const secretToolPath = process.platform === "win32"
    ? "C:\\Users\\qa-secret\\flutter\\bin\\flutter.bat"
    : "/home/qa-secret/flutter/bin/flutter";
  const server = new McpProcess({ FLUTTER_BIN: secretToolPath });
  t.after(() => server.close());
  await server.request(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flutter-mcp-smoke", version: "1.0.0" },
  });
  server.notify("notifications/initialized");
  const response = await server.request(2, "tools/call", {
    name: "analyze_code",
    arguments: { timeoutMs: 2_000 },
  });
  const serialized = JSON.stringify(response.result?.structuredContent ?? response);
  assert.doesNotMatch(serialized, /qa-secret/i);
  assert.doesNotMatch(serialized, /Users[\\/]qa-secret/i);
});
