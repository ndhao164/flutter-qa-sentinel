#!/usr/bin/env node
/** Ensure Codex can discover the project skill after a symlink-unfriendly checkout. */
import { cp, lstat, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = path.join(root, ".claude", "skills", "flutter-qa-engineer");
const mirror = path.join(root, ".agents", "skills", "flutter-qa-engineer");

await mkdir(path.dirname(mirror), { recursive: true });

try {
  await stat(path.join(mirror, "SKILL.md"));
  const entry = await lstat(mirror);
  if (entry.isSymbolicLink()) {
    console.log("Codex skill mirror is available:", path.relative(root, mirror));
    process.exit(0);
  }
  await cp(canonical, mirror, { recursive: true, force: true });
  console.log("Synchronized copied Codex skill mirror:", path.relative(root, mirror));
  process.exit(0);
} catch {
  // The symlink may be broken or the checkout may not preserve symlinks.
}

try {
  const link = await lstat(mirror);
  if (link.isSymbolicLink() || !link.isDirectory()) {
    await rm(mirror, { force: true });
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await cp(canonical, mirror, { recursive: true, force: true });
console.log("Copied Codex skill mirror for this checkout:", path.relative(root, mirror));
