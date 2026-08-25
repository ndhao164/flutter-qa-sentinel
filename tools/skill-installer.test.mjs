import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SOURCE,
  SKILL_NAME,
  configureProjectMcp,
  installTargets,
  parseArgs,
  resolveTargets,
  uninstallTargets,
  verifyTargets,
} from "./install-flutter-qa-skill.mjs";

function options(projectRoot, home, overrides = {}) {
  return {
    scope: "all",
    agents: new Set(["codex", "claude", "antigravity"]),
    projectRoot,
    home,
    source: DEFAULT_SOURCE,
    configureMcp: false,
    legacyAntigravity: true,
    force: false,
    verify: false,
    uninstall: false,
    dryRun: false,
    ...overrides,
  };
}

test("installer parses agent/scope options and deduplicates shared project target", () => {
  const parsed = parseArgs(["--scope", "all", "--agents", "all", "--configure-mcp", "--force"]);
  assert.equal(parsed.scope, "all");
  assert.deepEqual([...parsed.agents].sort(), ["antigravity", "claude", "codex"]);
  assert.equal(parsed.configureMcp, true);
  assert.equal(parsed.force, true);

  const targets = resolveTargets(options("C:/project", "C:/home"));
  assert.equal(targets.length, 6);
  const shared = targets.find((target) => target.path.endsWith(path.join(".agents", "skills", SKILL_NAME)));
  assert.deepEqual(shared?.agents.sort(), ["antigravity", "codex"]);
  assert.ok(targets.some((target) => target.path.endsWith(path.join(".gemini", "config", "skills", SKILL_NAME))));
  assert.ok(targets.some((target) => target.path.endsWith(path.join(".gemini", "antigravity-cli", "skills", SKILL_NAME))));
});

test("installer is idempotent, backs up conflicts, configures MCP, and removes only matching copies", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flutter-qa-installer-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  await Promise.all([mkdir(project, { recursive: true }), mkdir(home, { recursive: true })]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const installOptions = options(project, home);
  const first = await installTargets(installOptions);
  assert.equal(first.results.filter((result) => result.action === "installed").length, 6);
  assert.equal((await verifyTargets(installOptions)).ok, true);

  const second = await installTargets(installOptions);
  assert.ok(second.results.every((result) => ["unchanged", "linked"].includes(result.action)));

  const mcp = await configureProjectMcp({ ...installOptions, agents: new Set(["claude", "antigravity"]) });
  assert.equal(mcp.results.length, 3);
  const claudeConfig = JSON.parse(await readFile(path.join(project, ".claude", "mcp-config.json"), "utf8"));
  const claudeAutoConfig = JSON.parse(await readFile(path.join(project, ".mcp.json"), "utf8"));
  const agyConfig = JSON.parse(await readFile(path.join(project, ".agents", "mcp_config.json"), "utf8"));
  assert.equal(claudeConfig.mcpServers["flutter-qa"].command, "node");
  assert.equal(claudeAutoConfig.mcpServers["flutter-qa"].env.FLUTTER_MCP_ALLOW_ADB_MUTATIONS, "0");
  assert.equal(agyConfig.mcpServers["flutter-qa"].env.FLUTTER_MCP_ALLOW_IOS_MUTATIONS, "0");

  const codexDestination = path.join(home, ".codex", "skills", SKILL_NAME);
  await writeFile(path.join(codexDestination, "local-change.txt"), "do not overwrite\n", "utf8");
  await assert.rejects(() => installTargets(installOptions), /already exists and differs/);

  const forced = await installTargets({ ...installOptions, force: true });
  const replaced = forced.results.find((result) => result.destination === codexDestination);
  assert.ok(replaced?.backup);
  assert.match(replaced.backup, /[\\/]\.skill-backups[\\/]/);
  await access(path.join(codexDestination, "SKILL.md"));
  await access(replaced.backup);

  const removed = await uninstallTargets({ ...installOptions, force: true });
  assert.equal(removed.results.filter((result) => result.action === "uninstalled").length, 6);
  assert.equal((await verifyTargets(installOptions)).ok, false);
  assert.equal((await readdir(path.join(home, ".codex", "skills"))).length, 0);
  assert.equal((await readdir(path.join(home, ".codex", ".skill-backups"))).length, 1); // backup remains outside discovery path
});

test("dry-run never creates a destination", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flutter-qa-installer-dry-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await installTargets(options(project, path.join(root, "home"), { scope: "project", dryRun: true }));
  assert.ok(result.results.every((entry) => entry.action === "would-install"));
  await assert.rejects(() => access(path.join(project, ".agents", "skills", SKILL_NAME)));
});
