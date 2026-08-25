# Security policy

## Scope

This repository contains an agent-facing MCP server. It runs local Flutter,
Dart, ADB, Xcode, and `devicectl` commands on behalf of an AI host, so treat
every connected agent and device as an execution boundary.

## Supported versions

Only the latest commit on the default branch is currently supported. Pin the
repository revision and Node/Flutter toolchain in CI for reproducible use.

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private security advisory flow (or contact the repository owner privately) and
include reproduction steps, affected file/version, impact, and a proposed
mitigation if available.

## Security boundaries

- The server rejects paths outside `FLUTTER_PROJECT_ROOT` and uses argument
  arrays instead of shell interpolation.
- `run_adb_command` is allow-listed, but `tap` and `input_text` mutate a
  connected device and are disabled unless
  `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1` is set. Review/approve those operations
  explicitly.
- Screenshots and logcat can contain personal or customer data. Store them
  only in local ignored artifact directories and redact before sharing.
- `list_ios_devices` and `inspect_xcresult` are read-only. Flutter iOS
  integration runs, XCUITest, and all `ios_app_control` operations can build,
  install, launch, terminate, or drive an app and therefore require
  `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1`. Enable it only for a named, trusted test
  device and disable it after the authorized session.
- iOS operations accept only project-local workspaces, projects, app bundles,
  test targets, result bundles, and output paths. Do not grant an agent access
  to signing assets or Apple credentials beyond what the selected Xcode
  project already requires.
- `.xcresult` bundles, screenshots, device logs, crash reports, accessibility
  labels, and attachment metadata may contain personal data or secrets. Keep
  them in ignored local artifact directories, apply retention limits, and
  redact them before publication.
- VM Service access is loopback-only by default. `allowRemote` additionally
  requires `FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1`; do not enable either unless
  the endpoint is authenticated, isolated, and explicitly authorized. Auth
  paths are redacted from returned URI fields.
- VM Service response strings are scrubbed for the supplied auth path before
  they are returned; still treat app payloads and logs as sensitive.
- Never paste a VM Service URI, API key, token, or device log containing
  credentials into a public issue or commit.
- The cross-agent skill installer writes local MCP configuration only when
  `--configure-mcp` is requested. It refuses divergent skill/config targets by
  default; `--force` moves them into a `.skill-backups` directory outside the
  agent discovery path so backups are not loaded as duplicate skills.

## Dependency and release hygiene

Run `npm audit`, review the lockfile, scan the full Git history for secrets, and
verify the generated `dist/` files before publishing a release.
