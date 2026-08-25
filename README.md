# Flutter QA Sentinel

[English] · [Tiếng Việt](README.vi.md)

[![CI](https://github.com/ndhao164/flutter-qa-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/ndhao164/flutter-qa-sentinel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Reusable Agent Skill and local Model Context Protocol (MCP) tooling for
spec-driven Flutter QA. Flutter QA Sentinel gives Claude Code, Codex, and
Antigravity a repeatable workflow for inspecting a feature, generating tests,
checking responsive layouts, and collecting optional Android/iOS evidence.

This repository is a toolkit/template, not a complete Flutter application. It
does not contain an app `pubspec.yaml`, `lib/`, or an app-specific test suite.
Use it from an existing Flutter project, either in this checkout or from a
separate application directory.

## Contents

- [A-Z setup](#a-z-setup)
- [Prerequisites and supported baselines](#prerequisites-and-supported-baselines)
- [Quick start](#quick-start)
- [Repository map](#repository-map)
- [Install the Skill](#install-the-skill)
- [Configure MCP hosts](#configure-mcp-hosts)
- [Run the QA workflow](#run-the-qa-workflow)
- [MCP tools](#mcp-tools)
- [Android and ADB](#android-and-adb)
- [macOS and physical iOS](#macos-and-physical-ios)
- [Verification and CI](#verification-and-ci)
- [Public-release checklist](#public-release-checklist)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## A-Z setup

Use this order when integrating the toolkit into an existing Flutter app:

1. Install Node.js and the Flutter SDK; add Android or Apple tooling only when
   those device flows are in scope.
2. Install the canonical Skill into the project and, optionally, agent-global
   directories.
3. Build and test the local MCP server.
4. Register the MCP server with the agent host(s) you use.
5. Restart or reload the host so it rescans Skills and MCP servers.
6. Invoke `flutter-qa-engineer` with a feature spec and run the five-step QA
   workflow.
7. Collect device evidence only for an explicitly authorized emulator or
   physical device.
8. Run the release checks, review the staged file list, and then publish.

The Vietnamese translation follows the same sequence in
[`README.vi.md`](README.vi.md).

## Prerequisites and supported baselines

| Component | Baseline | Notes |
|---|---:|---|
| Node.js | 18.18+ | Required by the installer and MCP server; CI uses Node 20. |
| Flutter/Dart | Flutter 3.29+ / Dart 3.7+ | Match the channel pinned by the application under test. |
| MCP transport | Stdio | Works with Claude Code, Codex, Antigravity, and compatible hosts. |
| Android automation | Flutter SDK + Android Platform Tools | ADB mutations are opt-in. |
| iOS automation | macOS + Xcode 16+ | Uses `xcrun devicectl`, XCTest/XCUITest, and `xcresulttool`. |

The full matrix is in [`COMPATIBILITY.md`](COMPATIBILITY.md). iOS physical
device automation is macOS-only; Windows and Linux can still run the Flutter,
analyzer, widget-test, and Android portions.

Check the host before installing:

~~~powershell
node --version
flutter --version
flutter doctor -v
~~~

For Android, also check:

~~~powershell
adb version
adb devices -l
~~~

For a physical iPhone or iPad, run the MCP process on macOS and check:

~~~bash
xcode-select -p
xcodebuild -version
xcrun devicectl list devices
flutter devices
~~~

If an executable is not on `PATH`, set the overrides in the environment
inherited by the MCP process:

~~~powershell
$env:FLUTTER_BIN = "C:\path\to\flutter\bin\flutter.bat"
$env:ADB_BIN = "C:\path\to\Android\Sdk\platform-tools\adb.exe"
~~~

On macOS/Linux, export the equivalent `FLUTTER_BIN` and `ADB_BIN` values.

Physical iOS runs additionally require a trusted device with Developer Mode,
an iOS Runner target that builds and signs for that device, valid signing and
provisioning, a shared Xcode scheme for native XCUITest, and a writable
project-local directory for the `.xcresult` bundle. The server does not alter
Apple signing, entitlements, certificates, or provisioning settings.

## Quick start

### 1. Install the Skill and project MCP configuration

Run this from the toolkit root when the Flutter app is this checkout:

~~~powershell
node tools/install-flutter-qa-skill.mjs --scope project --agents all --configure-mcp
~~~

For an app in another directory, keep the toolkit checkout as the command
source and pass the app's absolute root:

~~~powershell
node C:/path/to/flutter-qa-sentinel/tools/install-flutter-qa-skill.mjs --project-root C:/path/to/my-flutter-app --scope project --agents all --configure-mcp
~~~

On macOS/Linux:

~~~bash
node /path/to/flutter-qa-sentinel/tools/install-flutter-qa-skill.mjs --project-root /path/to/my-flutter-app --scope project --agents all --configure-mcp
~~~

Equivalent wrappers are available; each wrapper resolves the repository root
from its own script path:

~~~powershell
.\scripts\install-skill.ps1 --scope project --agents all --configure-mcp
~~~

~~~bash
bash scripts/install-skill.sh --scope project --agents all --configure-mcp
~~~

The installer is idempotent. By default it refuses to replace a different
Skill or MCP entry. Use `--force` only when you intentionally want the old
copy backed up into `.skill-backups/` before replacement.

### 2. Build and verify the MCP server

~~~powershell
npm ci --prefix tools/flutter-mcp-server
npm run build --prefix tools/flutter-mcp-server
npm test --prefix tools/flutter-mcp-server
npm run validate:skill --prefix tools/flutter-mcp-server
~~~

For the complete local package check:

~~~powershell
npm run check --prefix tools/flutter-mcp-server
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
~~~

The agent must point at the generated
`tools/flutter-mcp-server/dist/index.js`; build the server in the toolkit
checkout before starting an agent.

### 3. Restart and verify discovery

After changing a Skill or MCP configuration, restart the host or reload its
workspace. Verify project copies without changing files:

~~~powershell
node tools/install-flutter-qa-skill.mjs --verify --scope project --agents all
~~~

Useful lifecycle commands:

~~~powershell
node tools/install-flutter-qa-skill.mjs --dry-run --scope all --agents all
node tools/install-flutter-qa-skill.mjs --scope global --agents all
node tools/install-flutter-qa-skill.mjs --scope all --agents all --configure-mcp
node tools/install-flutter-qa-skill.mjs --uninstall --scope all --agents all
~~~

## Repository map

| Path | Purpose |
|---|---|
| `.claude/skills/flutter-qa-engineer/` | Canonical Skill source for Claude Code. |
| `.agents/skills/flutter-qa-engineer/` | Project-local mirror for Codex and Antigravity. |
| `tools/flutter-mcp-server/` | Standalone TypeScript MCP server and tests. |
| `tools/install-flutter-qa-skill.mjs` | Cross-agent installer and lifecycle manager. |
| `scripts/install-skill.ps1` | Windows/PowerShell installer wrapper. |
| `scripts/install-skill.sh` | POSIX installer wrapper. |
| `docs/AGENT_INSTALLATION.md` | Compact installation runbook. |
| `examples/flutter_fixture/` | Deterministic responsive Flutter fixture. |
| `COMPATIBILITY.md` | Toolchain and platform support matrix. |
| `SECURITY.md` | Security boundaries and mutation gates. |
| `README.vi.md` | Vietnamese translation of this guide. |

The `.agents/skills/flutter-qa-engineer` entry is a synchronized project-local
mirror of the canonical `.claude/skills/flutter-qa-engineer` directory. The
installer can repair it on filesystems where Git symlinks are not preserved.

## Install the Skill

| Host | Project scope | Global scope |
|---|---|---|
| Claude Code | `.claude/skills/flutter-qa-engineer` | `~/.claude/skills/flutter-qa-engineer` |
| Codex | `.agents/skills/flutter-qa-engineer` | `$CODEX_HOME/skills/flutter-qa-engineer` or `~/.codex/skills/flutter-qa-engineer` |
| Antigravity IDE | `.agents/skills/flutter-qa-engineer` | `~/.gemini/config/skills/flutter-qa-engineer` |
| Antigravity CLI | `.agents/skills/flutter-qa-engineer` | `~/.gemini/antigravity-cli/skills/flutter-qa-engineer` |

Claude Code reads the canonical `.claude` path. Codex and Antigravity share
the project-local `.agents` copy so one project checkout has one Skill contract.

Safe lifecycle commands:

~~~powershell
node tools/install-flutter-qa-skill.mjs --verify --scope all --agents all
node tools/install-flutter-qa-skill.mjs --dry-run --scope all --agents all
node tools/install-flutter-qa-skill.mjs --force --scope all --agents all
node tools/install-flutter-qa-skill.mjs --uninstall --scope all --agents all
~~~

## Configure MCP hosts

`--configure-mcp` creates or merges project-local entries while keeping every
mutation gate closed:

- `.mcp.json` — Claude Code auto-discovery; ignored because it contains local paths.
- `.claude/mcp-config.json` — shareable Claude Code template.
- `.agents/mcp_config.json` — Antigravity workspace configuration.

The copy-ready server template is
[`tools/flutter-mcp-server/mcp-config.example.json`](tools/flutter-mcp-server/mcp-config.example.json).

### Claude Code and Claude Desktop

~~~powershell
claude --mcp-config .claude/mcp-config.json
claude mcp list
~~~

Approve a server shown as **Pending approval** and restart the session. Claude
Desktop normally reads `%APPDATA%\Claude\claude_desktop_config.json`; copy the
`flutter-qa` entry and replace the project path with an absolute path.

~~~json
{
  "mcpServers": {
    "flutter-qa": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/flutter-qa-sentinel/tools/flutter-mcp-server/dist/index.js"],
      "env": {
        "FLUTTER_PROJECT_ROOT": "C:/path/to/my-flutter-app",
        "FLUTTER_MCP_TIMEOUT_MS": "120000",
        "FLUTTER_MCP_ALLOW_ADB_MUTATIONS": "0",
        "FLUTTER_MCP_ALLOW_IOS_MUTATIONS": "0",
        "FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE": "0"
      }
    }
  }
}
~~~

### Codex CLI, desktop, and IDE

Register the server with an absolute entry point from the Flutter app root:

~~~powershell
$root = (Get-Location).Path
$server = 'C:/path/to/flutter-qa-sentinel/tools/flutter-mcp-server/dist/index.js'
codex mcp add flutter-qa --env "FLUTTER_PROJECT_ROOT=$root" --env FLUTTER_MCP_TIMEOUT_MS=120000 --env FLUTTER_MCP_ALLOW_ADB_MUTATIONS=0 --env FLUTTER_MCP_ALLOW_IOS_MUTATIONS=0 --env FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=0 -- node $server
codex mcp list
~~~

For a same-checkout setup, set `$server` to the built server under the current
root. An equivalent trusted TOML entry can be placed in `~/.codex/config.toml`:

~~~toml
[mcp_servers.flutter-qa]
command = "node"
args = ["/absolute/path/to/flutter-qa-sentinel/tools/flutter-mcp-server/dist/index.js"]
cwd = "/absolute/path/to/my-flutter-app"
startup_timeout_sec = 20
tool_timeout_sec = 120

[mcp_servers.flutter-qa.env]
FLUTTER_PROJECT_ROOT = "/absolute/path/to/my-flutter-app"
FLUTTER_MCP_TIMEOUT_MS = "120000"
FLUTTER_MCP_ALLOW_ADB_MUTATIONS = "0"
FLUTTER_MCP_ALLOW_IOS_MUTATIONS = "0"
FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE = "0"
~~~

### Antigravity IDE and CLI

Antigravity discovers the project Skill from
`.agents/skills/flutter-qa-engineer` and MCP from `.agents/mcp_config.json`.
The installer creates both with `--configure-mcp`. Reload the workspace after
installation. Global installation supports both current and legacy CLI paths.

## Run the QA workflow

Use any trigger after restarting the host:

- `qa feature`
- `test flutter`
- `check overflow`

Direct invocation:
- Claude Code / Antigravity: `/flutter-qa-engineer`
- Codex: `$flutter-qa-engineer` or `/skills`

~~~text
qa feature
Read docs/features/<feature>.md, inspect the related lib/ code, build the
happy-path/edge/error/validation matrix, run the responsive overflow guard, and
return an evidence report. Do not use a real device unless I authorize it.
~~~

The Skill's five required steps are:

1. **Ingestion** — read the authoritative spec and map Widget, State/controller,
   domain, and Repository/API code under `lib/`.
2. **Matrix planning** — cover happy paths, edge/boundary cases, network/API
   failures, retries, and form validation.
3. **Test-suite generation** — create unit/widget tests using the app's existing
   Mockito/Mocktail and Provider/Riverpod/Bloc conventions.
4. **Responsive and overflow guard** — run every widget case at `320x568`,
   `390x844`, and `844x390` (plus compact landscape when relevant), with text
   scales `1.0` and `1.5`; `RenderFlex overflowed` is a failure.
5. **Self-healing loop** — classify feature/spec, test, or environment failures,
   make a bounded repair, rerun, and report a blocker instead of using `skip` or
   `todo`.

Read the canonical contract at
[`SKILL.md`](.claude/skills/flutter-qa-engineer/SKILL.md) and the reusable
harness at
[`widget_test_template.md`](.claude/skills/flutter-qa-engineer/prompts/widget_test_template.md).

## MCP tools

The server exposes ten bounded tools over stdio:

| Tool | Primary use | Default state |
|---|---|---|
| `run_flutter_tests` | Focused/full Flutter tests with parsed counts, stacks, and overflow lines. | Read-only |
| `analyze_code` | Structured `flutter analyze` diagnostics. | Read-only |
| `query_vm_service` | Loopback Dart VM Service inspection. | Read-only |
| `check_layout_overflow` | Responsive breakpoint matrix and static risk scan. | Read-only |
| `run_adb_command` | Device discovery, screenshots, crash logcat, tap/type. | Tap/type gated |
| `list_ios_devices` | Physical iPhone/iPad discovery via `devicectl`. | Read-only |
| `run_ios_integration_tests` | Flutter `integration_test` on one selected iOS device. | iOS gate |
| `run_xcuitests` | Native XCTest/XCUITest on one selected iOS device. | iOS gate |
| `ios_app_control` | Bounded install/launch/terminate through `devicectl`. | iOS gate |
| `inspect_xcresult` | Read an existing `.xcresult` bundle. | Read-only |

Typical MCP payloads:

~~~json
{"tool":"analyze_code","arguments":{"cwd":".","format":"machine"}}
~~~

~~~json
{"tool":"run_flutter_tests","arguments":{"testPath":"test/features/example/example_test.dart","coverage":false}}
~~~

~~~json
{"tool":"check_layout_overflow","arguments":{"testPath":"test/features/example/example_widget_test.dart","mode":"both","textScales":[1,1.5]}}
~~~

## Android and ADB

Use `run_adb_command` for discovery, screenshots, crash logs, and explicitly
authorized interaction:

~~~json
{"tool":"run_adb_command","arguments":{"operation":"devices"}}
~~~

~~~json
{"tool":"run_adb_command","arguments":{"operation":"screencap","outputPath":".artifacts/android/screen.png"}}
~~~

~~~json
{"tool":"run_adb_command","arguments":{"operation":"logcat_crash","lines":200}}
~~~

`tap` and `input_text` are rejected unless the authorized session opens:

~~~powershell
$env:FLUTTER_MCP_ALLOW_ADB_MUTATIONS = "1"
~~~

Keep screenshots and logcat in ignored `.artifacts/` directories and redact
personal data before sharing.

## macOS and physical iOS

iOS automation requires the MCP process to run on macOS with active Xcode; it is
not emulated by a Windows/Linux adapter.

1. Call `list_ios_devices` (read-only).
2. Select exactly one `deviceId` returned by that call.
3. Confirm trust, Developer Mode, signing/provisioning, and a buildable Runner.
4. Set `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1` for the authorized session only.
5. Use `run_ios_integration_tests` for Flutter-owned UI.
6. Use `run_xcuitests` for native views, permission dialogs, system UI, or
   accessibility-tree interaction outside Flutter's widget binding.
7. Use `inspect_xcresult` for the non-empty result bundle.
8. Unset the gate and restart the MCP process.

~~~bash
xcode-select -p
xcodebuild -version
xcrun devicectl list devices
flutter devices
export FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1
~~~

Native XCUITest additionally needs a valid XCTest target, shared Xcode scheme,
signing/provisioning for the selected device, and a writable ignored result
directory. The server does not modify Apple project settings. Never silently
switch to another device if the chosen identifier disappears.

~~~bash
unset FLUTTER_MCP_ALLOW_IOS_MUTATIONS
~~~

## Verification and CI

~~~powershell
npm run check --prefix tools/flutter-mcp-server
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
node tools/validate-flutter-qa-skill.mjs
node --test tools/skill-installer.test.mjs
~~~

For the bundled fixture:

~~~powershell
Push-Location examples/flutter_fixture
flutter pub get
flutter analyze
dart format --output=none --set-exit-if-changed lib test
flutter test
Pop-Location
npm run test:fixture --prefix tools/flutter-mcp-server
~~~

GitHub Actions runs these checks when the server, Skill, installer, fixture, or
documentation changes: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Public-release checklist

~~~powershell
node tools/install-flutter-qa-skill.mjs --verify --scope project --agents all
npm run check --prefix tools/flutter-mcp-server
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
git diff --check
git status --short --untracked-files=all
~~~

Confirm that machine-local settings and runtime artifacts are absent from the
staged file list: `.mcp.json`, `.codex/config.toml`, `.skill-backups/`,
`.artifacts/`, `.dart_tool/`, `build/`, `coverage/`, `node_modules/`, screenshots,
logcat, VM Service URIs, tokens, credentials, and raw `.xcresult` attachments.

Review both [`README.md`](README.md) and [`README.vi.md`](README.vi.md), plus
[`SECURITY.md`](SECURITY.md), [`COMPATIBILITY.md`](COMPATIBILITY.md), license
wording, audit output, and generated `dist/` files before pushing.

## Troubleshooting

| Symptom | Check |
|---|---|
| Skill is not listed | Restart/reload the host, then run the installer with `--verify`. |
| MCP server is not visible | Build `dist/index.js`, use an absolute config path, and inspect `claude mcp list` or `codex mcp list`. |
| Flutter command fails | Confirm `flutter` is on `PATH` or set `FLUTTER_BIN`; run `flutter doctor -v`. |
| iOS fails on Windows/Linux | Move the MCP process to macOS with Xcode 16+; physical automation is macOS-only. |
| Android tap/type is rejected | Set `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1` only for the authorized session. |
| iOS operation is rejected | Set `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1`, then restart MCP. |
| Device identifier is missing | Run `list_ios_devices` again; never guess a fallback device. |
| XCUITest cannot build/install | Check Developer Mode, trust, signing/provisioning, XCTest target, shared scheme, and result path. |
| Overflow is reported | Keep the assertion, classify fixture versus product defect, and fix constraints or test setup; never use `skip`. |

## Related documentation

- [Vietnamese guide](README.vi.md)
- [Agent installation runbook](docs/AGENT_INSTALLATION.md)
- [Flutter MCP server reference](tools/flutter-mcp-server/README.md)
- [Compatibility matrix](COMPATIBILITY.md)
- [Security policy](SECURITY.md)
- [Change log](CHANGELOG.md)
- [Codex MCP documentation](https://developers.openai.com/codex/mcp)
- [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Antigravity Agent Skills](https://antigravity.google/docs/skills/)

## License

Released under the [MIT License](LICENSE).
