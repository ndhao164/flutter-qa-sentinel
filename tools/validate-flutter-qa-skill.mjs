#!/usr/bin/env node
/** Lightweight contract check for the repository's Flutter QA skill. */
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoots = [
  path.join(root, ".claude", "skills", "flutter-qa-engineer"),
  path.join(root, ".agents", "skills", "flutter-qa-engineer"),
];
const codexMetadata = path.join(skillRoots[0], "agents", "openai.yaml");
const installer = path.join(root, "tools", "install-flutter-qa-skill.mjs");
const antigravityMcp = path.join(root, ".agents", "mcp_config.json");
const requiredHeadings = [
  "Ingestion",
  "Matrix Planning",
  "Test Suite Generation",
  "Responsive & Overflow Guard",
  "Self-healing loop",
];
const requiredTriggers = ["qa feature", "test flutter", "check overflow"];

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const skillRoot of skillRoots) {
  const skillFile = path.join(skillRoot, "SKILL.md");
  const templateFile = path.join(skillRoot, "prompts", "widget_test_template.md");
  try {
    await access(skillFile);
    await access(templateFile);
  } catch {
    failures.push(`Missing skill artifact: ${path.relative(root, skillRoot)}`);
    continue;
  }
  const skill = await readFile(skillFile, "utf8");
  const template = await readFile(templateFile, "utf8");
  check(/^name:\s*flutter-qa-engineer\s*$/m.test(skill), `${skillFile}: name metadata missing`);
  check(/^description:\s*.+$/m.test(skill), `${skillFile}: description metadata missing`);
  for (const trigger of requiredTriggers) check(skill.toLowerCase().includes(trigger), `${skillFile}: trigger missing: ${trigger}`);
  for (const heading of requiredHeadings) check(skill.toLowerCase().includes(heading.toLowerCase()), `${skillFile}: SOP section missing: ${heading}`);
  for (const dimension of ["320x568", "390x844", "844x390", "1.5"]) check(skill.includes(dimension), `${skillFile}: responsive requirement missing: ${dimension}`);
  for (const concept of ["mocktail", "mockito", "provider", "riverpod", "bloc", "physicalSize", "textScale"]) {
    check(template.toLowerCase().includes(concept.toLowerCase()), `${templateFile}: template concept missing: ${concept}`);
  }
}

try {
  const [metadata, installerSource, mcpSource] = await Promise.all([
    readFile(codexMetadata, "utf8"),
    readFile(installer, "utf8"),
    readFile(antigravityMcp, "utf8"),
  ]);
  check(metadata.includes('display_name: "Flutter QA Engineer"'), `${codexMetadata}: display_name missing`);
  check(metadata.includes("$flutter-qa-engineer"), `${codexMetadata}: default prompt must mention the skill`);
  for (const agent of ["codex", "claude", "antigravity"]) {
    check(installerSource.includes(`"${agent}"`), `${installer}: target missing: ${agent}`);
  }
  const mcp = JSON.parse(mcpSource);
  check(mcp?.mcpServers?.["flutter-qa"]?.command === "node", `${antigravityMcp}: flutter-qa MCP entry missing`);
} catch (error) {
  failures.push(`Cross-agent installation artifact invalid: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length > 0) {
  console.error(`Flutter QA skill validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Flutter QA skill validation passed for .claude and .agents copies.");
}
