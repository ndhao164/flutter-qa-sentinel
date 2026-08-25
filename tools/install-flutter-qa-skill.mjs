#!/usr/bin/env node
/**
 * Install the Flutter QA Agent Skill for Claude Code, Codex, and Antigravity.
 *
 * The installer is deliberately copy-based and idempotent. It never replaces
 * an existing, different skill directory unless --force is supplied; forced
 * replacements are moved to a timestamped backup first.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SKILL_NAME = "flutter-qa-engineer";
export const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SOURCE = path.join(SCRIPT_ROOT, ".claude", "skills", SKILL_NAME);

const DEFAULT_SCOPE = "project";
const AGENTS = new Set(["codex", "claude", "antigravity"]);
const SCOPES = new Set(["project", "global", "all"]);

function usage() {
  return `
Install Flutter QA skill for Codex, Claude Code, and Antigravity.

Usage:
  node tools/install-flutter-qa-skill.mjs [options]

Options:
  --scope project|global|all       Install location (default: project)
  --agents all|codex,claude,antigravity
                                   Target agents (default: all)
  --project-root <path>            Workspace to receive project skills
  --source <path>                  Skill source (default: this repository)
  --configure-mcp                  Create/verify Claude + Antigravity MCP config
  --no-legacy-antigravity          Do not install the Antigravity CLI legacy path
  --force                          Back up and replace conflicting destinations
  --verify                         Verify destinations without changing files
  --uninstall                      Remove only matching installed copies
  --dry-run                        Print actions without changing files
  --help                           Show this help

Examples:
  node tools/install-flutter-qa-skill.mjs --scope all --agents all --configure-mcp
  node tools/install-flutter-qa-skill.mjs --scope project --project-root /work/my-app
  node tools/install-flutter-qa-skill.mjs --scope global --agents antigravity
  node tools/install-flutter-qa-skill.mjs --verify --scope all
`;
}

export function parseArgs(argv) {
  const options = {
    scope: DEFAULT_SCOPE,
    agents: new Set(["codex", "claude", "antigravity"]),
    projectRoot: process.cwd(),
    source: DEFAULT_SOURCE,
    configureMcp: false,
    legacyAntigravity: true,
    force: false,
    verify: false,
    uninstall: false,
    dryRun: false,
    help: false,
  };
  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--scope": {
        const value = takeValue(index, argument);
        index += 1;
        if (!SCOPES.has(value)) throw new Error(`--scope must be one of ${[...SCOPES].join(", ")}.`);
        options.scope = value;
        break;
      }
      case "--agents": {
        const value = takeValue(index, argument);
        index += 1;
        const names = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
        if (names.length === 0 || (names.includes("all") && names.length !== 1) || names.some((item) => item !== "all" && !AGENTS.has(item))) {
          throw new Error("--agents must contain codex, claude, antigravity, or all.");
        }
        options.agents = names.includes("all")
          ? new Set(AGENTS)
          : new Set(names);
        break;
      }
      case "--project-root":
        options.projectRoot = takeValue(index, argument);
        index += 1;
        break;
      case "--source":
        options.source = takeValue(index, argument);
        index += 1;
        break;
      case "--configure-mcp":
        options.configureMcp = true;
        break;
      case "--no-legacy-antigravity":
        options.legacyAntigravity = false;
        break;
      case "--force":
        options.force = true;
        break;
      case "--verify":
        options.verify = true;
        break;
      case "--uninstall":
      case "--remove":
        options.uninstall = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.verify && options.uninstall) throw new Error("--verify and --uninstall cannot be combined.");
  if (options.dryRun && options.verify) throw new Error("--dry-run and --verify cannot be combined.");
  if (options.uninstall && options.configureMcp) throw new Error("--configure-mcp cannot be combined with --uninstall.");
  return options;
}

function absolute(value, base = process.cwd()) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("A path value cannot be empty.");
  return path.resolve(base, value);
}

function homeDirectory() {
  return path.resolve(process.env.HOME || process.env.USERPROFILE || os.homedir());
}

function addTarget(targets, target) {
  const existing = targets.find((item) => item.path === target.path);
  const agents = target.agents ?? [target.agent];
  if (existing) {
    existing.agents = [...new Set([...existing.agents, ...agents])];
    return;
  }
  targets.push({ ...target, agents: [...agents] });
}

/** Resolve the concrete skill destinations for the requested agents/scopes. */
export function resolveTargets(options, { home = homeDirectory() } = {}) {
  const projectRoot = absolute(options.projectRoot);
  const targets = [];
  const addProject = (agent, relativePath) => addTarget(targets, {
    agent,
    scope: "project",
    path: path.join(projectRoot, relativePath, SKILL_NAME),
    label: `${agent} project skill`,
  });
  const addGlobal = (agent, root, label) => addTarget(targets, {
    agent,
    scope: "global",
    path: path.join(root, "skills", SKILL_NAME),
    label,
  });

  if (options.scope === "project" || options.scope === "all") {
    if (options.agents.has("claude")) addProject("claude", path.join(".claude", "skills"));
    if (options.agents.has("codex")) addProject("codex", path.join(".agents", "skills"));
    // Codex and Antigravity intentionally share the project-local open skill
    // location and therefore receive one synchronized copy.
    if (options.agents.has("antigravity")) addProject("antigravity", path.join(".agents", "skills"));
  }
  if (options.scope === "global" || options.scope === "all") {
    if (options.agents.has("codex")) {
      addGlobal("codex", absolute(process.env.CODEX_HOME || path.join(home, ".codex")), "Codex global skill");
    }
    if (options.agents.has("claude")) {
      addGlobal("claude", absolute(process.env.CLAUDE_HOME || path.join(home, ".claude")), "Claude Code global skill");
    }
    if (options.agents.has("antigravity")) {
      const geminiHome = absolute(process.env.GEMINI_HOME || path.join(home, ".gemini"));
      addGlobal("antigravity", path.join(geminiHome, "config"), "Antigravity global skill");
      if (options.legacyAntigravity) {
        addGlobal("antigravity", path.join(geminiHome, "antigravity-cli"), "Antigravity CLI compatibility skill");
      }
    }
  }
  return targets;
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertSkillSource(source) {
  const resolved = absolute(source);
  const skillFile = path.join(resolved, "SKILL.md");
  const templateFile = path.join(resolved, "prompts", "widget_test_template.md");
  const skillStat = await stat(skillFile).catch(() => null);
  const templateStat = await stat(templateFile).catch(() => null);
  if (!skillStat?.isFile() || !templateStat?.isFile()) {
    throw new Error(`Skill source is incomplete: ${resolved} (SKILL.md and prompts/widget_test_template.md are required).`);
  }
  return resolved;
}

async function hashTree(directory) {
  const hash = createHash("sha256");
  const visit = async (current, relative = "") => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name).split(path.sep).join("/");
      hash.update(`${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}:${childRelative}\n`);
      if (entry.isDirectory()) {
        await visit(child, childRelative);
      } else if (entry.isSymbolicLink()) {
        hash.update(`target:${await readlink(child)}\n`);
      } else {
        hash.update(await readFile(child));
      }
    }
  };
  await visit(directory);
  return hash.digest("hex");
}

async function destinationState(source, destination) {
  let entry;
  try {
    entry = await lstat(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "missing", same: false };
    throw error;
  }
  if (entry.isSymbolicLink()) {
    const sourceReal = await realpath(source);
    const destinationReal = await realpath(destination).catch(() => null);
    return { kind: "symlink", same: destinationReal === sourceReal, linkTarget: destinationReal };
  }
  if (!entry.isDirectory()) return { kind: "other", same: false };
  return { kind: "directory", same: (await hashTree(source)) === (await hashTree(destination)) };
}

function displayPath(target, base = process.cwd()) {
  const relative = path.relative(base, target);
  return (relative || ".").split(path.sep).join("/");
}

async function backupDestination(destination, dryRun) {
  const destinationParent = path.dirname(destination);
  const backupRoot = path.basename(destinationParent) === "skills"
    ? path.join(path.dirname(destinationParent), ".skill-backups")
    : path.join(destinationParent, ".skill-backups");
  const safeName = path.basename(destination).replace(/[^A-Za-z0-9_.-]/g, "_");
  const backup = path.join(
    backupRoot,
    `${safeName}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
  );
  if (!dryRun) {
    await mkdir(backupRoot, { recursive: true });
    await rename(destination, backup);
  }
  return backup;
}

async function copyOne(source, target, options) {
  const sourceReal = await realpath(source);
  const destination = absolute(target.path);
  if (destination === sourceReal || (await realpath(destination).catch(() => null)) === sourceReal) {
    return { action: "linked", target, destination };
  }
  const state = await destinationState(source, destination);
  if (state.same) return { action: state.kind === "symlink" ? "linked" : "unchanged", target, destination };
  if (state.kind !== "missing" && !options.force) {
    throw new Error(`${target.label} already exists and differs: ${destination}. Use --force to back it up and replace it.`);
  }
  const backup = state.kind === "missing" ? null : await backupDestination(destination, options.dryRun);
  if (!options.dryRun) {
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
    } catch (error) {
      if (backup) await rename(backup, destination).catch(() => undefined);
      throw error;
    }
    const copied = await destinationState(source, destination);
    if (!copied.same) throw new Error(`Post-install verification failed: ${destination}`);
  }
  return { action: options.dryRun ? "would-install" : "installed", target, destination, backup };
}

async function removeOne(source, target, options) {
  const destination = absolute(target.path);
  const state = await destinationState(source, destination);
  if (state.kind === "missing") return { action: "absent", target, destination };
  if (destination === await realpath(source)) {
    return { action: "protected-source", target, destination };
  }
  if (state.kind === "symlink" && state.same) {
    return { action: "protected-link", target, destination };
  }
  if (!state.same && !options.force) {
    throw new Error(`${target.label} differs from this skill and was not removed: ${destination}. Use --force to remove it.`);
  }
  if (!options.dryRun) await rm(destination, { recursive: true, force: true });
  return { action: options.dryRun ? "would-uninstall" : "uninstalled", target, destination };
}

export async function installTargets(options) {
  const source = await assertSkillSource(options.source);
  const targets = resolveTargets(options, { home: options.home });
  const results = [];
  for (const target of targets) results.push(await copyOne(source, target, options));
  return { source, targets, results };
}

export async function uninstallTargets(options) {
  const source = await assertSkillSource(options.source);
  const targets = resolveTargets(options, { home: options.home });
  const results = [];
  for (const target of targets) results.push(await removeOne(source, target, options));
  return { source, targets, results };
}

export async function verifyTargets(options) {
  const source = await assertSkillSource(options.source);
  const targets = resolveTargets(options, { home: options.home });
  const results = [];
  for (const target of targets) {
    const state = await destinationState(source, absolute(target.path));
    results.push({ target, destination: absolute(target.path), ...state });
  }
  return { source, targets, results, ok: results.every((item) => item.same) };
}

function serverConfig(projectRoot) {
  const root = absolute(projectRoot);
  const serverEntry = path.join(SCRIPT_ROOT, "tools", "flutter-mcp-server", "dist", "index.js");
  const sameProject = path.resolve(root) === path.resolve(SCRIPT_ROOT);
  const entry = sameProject ? "tools/flutter-mcp-server/dist/index.js" : serverEntry;
  return {
    command: "node",
    args: [entry],
    cwd: sameProject ? "." : root,
    env: {
      FLUTTER_PROJECT_ROOT: sameProject ? "." : root,
      FLUTTER_MCP_TIMEOUT_MS: "120000",
      FLUTTER_MCP_ALLOW_ADB_MUTATIONS: "0",
      FLUTTER_MCP_ALLOW_IOS_MUTATIONS: "0",
      FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE: "0",
    },
  };
}

async function writeJsonSafely(file, value, options) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const existing = await readFile(file, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing === serialized) return { action: "unchanged", path: file };
  if (existing !== null && !options.force) {
    throw new Error(`Configuration already exists and differs: ${file}. Use --force to back it up and replace it.`);
  }
  let backup = null;
  if (existing !== null) backup = await backupDestination(file, options.dryRun);
  if (!options.dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, serialized, "utf8");
  }
  return { action: options.dryRun ? "would-configure" : "configured", path: file, backup };
}

function looksLikeFlutterMcpServer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value.command;
  const args = Array.isArray(value.args) ? value.args : [];
  return command === "node"
    && args.some((item) => typeof item === "string" && item.replaceAll("\\", "/").endsWith("tools/flutter-mcp-server/dist/index.js"));
}

async function mergeMcpEntry(file, entry, options) {
  const existingText = await readFile(file, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existingText === null) {
    return writeJsonSafely(file, { mcpServers: { "flutter-qa": entry } }, options);
  }
  let existing;
  try {
    existing = JSON.parse(existingText);
  } catch (error) {
    throw new Error(`Cannot parse existing MCP config ${file}: ${error instanceof Error ? error.message : String(error)}. Back it up or use --force.`);
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw new Error(`Existing MCP config must be a JSON object: ${file}.`);
  }
  const servers = existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)
    ? existing.mcpServers
    : {};
  const current = servers["flutter-qa"];
  if (current && looksLikeFlutterMcpServer(current) && !options.force) {
    return { action: "preserved-existing", path: file };
  }
  if (current && !options.force) {
    throw new Error(`MCP entry flutter-qa already exists and differs: ${file}. Use --force to back up and replace it.`);
  }
  const merged = { ...existing, mcpServers: { ...servers, "flutter-qa": entry } };
  return writeJsonSafely(file, merged, options);
}

/** Create the project-level MCP files used by Claude Code and Antigravity. */
export async function configureProjectMcp(options) {
  const root = absolute(options.projectRoot);
  const config = serverConfig(root);
  const results = [];
  if (options.agents.has("claude")) {
    results.push(await mergeMcpEntry(path.join(root, ".claude", "mcp-config.json"), { type: "stdio", ...config }, options));
    // Claude Code auto-discovers the project-level .mcp.json. Keep the
    // checked-in .claude config as a shareable template, while this ignored
    // file makes the one-command installer immediately usable locally.
    results.push(await mergeMcpEntry(path.join(root, ".mcp.json"), { type: "stdio", ...config }, options));
  }
  if (options.agents.has("antigravity")) {
    results.push(await mergeMcpEntry(path.join(root, ".agents", "mcp_config.json"), config, options));
  }
  return { results, config };
}

function printResults(operation, outcome, base) {
  console.log(`${operation} ${SKILL_NAME}`);
  console.log(`source: ${displayPath(outcome.source, base)}`);
  for (const result of outcome.results) {
    const owners = result.target.agents.join("+");
    const pathText = displayPath(result.destination, base);
    const action = result.action ?? (result.same ? "verified" : result.kind ?? "different");
    const suffix = result.backup ? ` (backup: ${displayPath(result.backup, base)})` : "";
    console.log(`  ${action.padEnd(14)} ${owners.padEnd(18)} ${pathText}${suffix}`);
  }
  if (outcome.configResults) {
    for (const result of outcome.configResults) {
      const suffix = result.backup ? ` (backup: ${displayPath(result.backup, base)})` : "";
      console.log(`  ${result.action.padEnd(14)} MCP config         ${displayPath(result.path, base)}${suffix}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.configureMcp && (options.scope === "global" || options.scope === "all")) {
    // MCP files are intentionally workspace-local. Installing global skills
    // and configuring the current workspace is useful, but make it explicit
    // in the output rather than silently editing a global MCP registry.
    console.log("MCP configuration is workspace-local; configuring the selected project root.");
  }
  let outcome;
  let operation;
  if (options.verify) {
    outcome = await verifyTargets(options);
    operation = outcome.ok ? "Verified" : "Verification failed for";
  } else if (options.uninstall) {
    outcome = await uninstallTargets(options);
    operation = "Uninstalled";
  } else {
    outcome = await installTargets(options);
    operation = "Installed";
    if (options.configureMcp) {
      const configured = await configureProjectMcp(options);
      outcome.configResults = configured.results;
    }
  }
  printResults(operation, outcome, absolute(options.projectRoot));
  if (options.verify && !outcome.ok) return 1;
  return 0;
}

const invokedDirectly = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`Skill installation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
