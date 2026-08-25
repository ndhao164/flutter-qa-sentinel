# Flutter QA Sentinel

[![CI](https://github.com/ndhao164/flutter-qa-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/ndhao164/flutter-qa-sentinel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Reusable Agent Skill + local MCP tooling that acts as a guarded sentinel for
spec-driven Flutter QA.

Flutter QA Sentinel is a toolkit/template, not a complete Flutter app. It does
not include `pubspec.yaml`, `lib/`, or an app-specific `test/` suite. Use it to
wire an existing Flutter project into a repeatable QA workflow.

Tiếng Việt: Flutter QA Sentinel là bộ công cụ mẫu cho QA Flutter theo spec,
không phải một ứng dụng Flutter hoàn chỉnh. Repo này không có `pubspec.yaml`,
`lib/`, hay bộ test riêng cho app. Hãy dùng nó để gắn vào một dự án Flutter
đang có sẵn.

Licensed under the [MIT License](LICENSE).

English is the primary language in this guide. Vietnamese notes are placed
directly below the corresponding English instructions so a team can use one
canonical runbook while keeping the operational details easy to scan.

Repository: [github.com/ndhao164/flutter-qa-sentinel](https://github.com/ndhao164/flutter-qa-sentinel)

## Contents

- [A-Z Setup Path](#a-z-setup-path)
- [Before You Start](#before-you-start)
- [Quick Start](#quick-start)
- [What the Skill Does](#what-the-skill-does)
- [What the MCP Server Does](#what-the-mcp-server-does)
- [Android Workflow](#android-workflow)
- [macOS and Physical iOS Devices](#macos-and-physical-ios-devices)
- [Configuration Examples](#configuration-examples)
- [Public Release Checklist](#public-release-checklist)
- [Troubleshooting](#troubleshooting)

**Vietnamese:** Mục lục giúp mở nhanh các phần setup, workflow, thiết bị và
checklist public.

## A-Z Setup Path

English:

Follow the sections in this order when wiring the kit into an existing Flutter
application:

1. Prepare Node.js, Flutter, and (when needed) Android or Apple tooling.
2. Install the Skill into the project and/or the agent's global directory.
3. Build the local MCP server and verify its test suite.
4. Register MCP with Claude Code, Codex, and/or Antigravity.
5. Restart the host, invoke `flutter-qa-engineer`, and run the five-step QA loop.
6. Collect Android or iOS evidence only when the device scope is authorized.
7. Run the public-release checklist before publishing this toolkit.

Tiếng Việt:

Khi gắn bộ công cụ vào một ứng dụng Flutter có sẵn, hãy đi theo thứ tự:

1. Chuẩn bị Node.js, Flutter và tool Android hoặc Apple nếu cần.
2. Cài Skill vào project và/hoặc thư mục global của agent.
3. Build MCP server local và kiểm tra bộ test của server.
4. Đăng ký MCP với Claude Code, Codex và/hoặc Antigravity.
5. Restart host, gọi `flutter-qa-engineer`, rồi chạy vòng QA năm bước.
6. Chỉ thu thập bằng chứng Android/iOS khi phiên thiết bị đã được cấp quyền.
7. Chạy checklist public-release trước khi public toolkit.

## Before You Start

English:

This is a toolkit repository, so the application under test may live in the
same repository or in a different directory. The application root must contain
`pubspec.yaml` and normally `lib/`; the toolkit root must contain
`tools/flutter-mcp-server/dist/index.js` after the server build.

Check the host before installing:

```powershell
node --version
flutter --version
flutter doctor -v
```

On Android hosts, also verify:

```powershell
adb version
adb devices -l
```

If the SDK tools are not on `PATH`, set the server-process overrides before
starting an agent:

```powershell
$env:FLUTTER_BIN = "C:\path\to\flutter\bin\flutter.bat"
$env:ADB_BIN = "C:\path\to\Android\Sdk\platform-tools\adb.exe"
```

On macOS/Linux use the corresponding executable paths (`flutter` and `adb`),
and export them in the shell that launches the MCP host.

On macOS hosts that will exercise a physical iPhone or iPad, verify the Apple
toolchain before starting an agent:

```bash
xcode-select -p
xcodebuild -version
xcrun devicectl list devices
flutter devices
```

Node.js 18.18 or newer is required by the installer and MCP server. Flutter
and Dart versions should match the application's pinned channel; the bundled
fixture is tested against Flutter 3.29+ / Dart 3.7+. A physical iOS run also
needs a trusted device, Developer Mode, valid signing/provisioning, and a
shared Xcode scheme.

Tiếng Việt:

Đây là repository của toolkit, nên app cần test có thể nằm cùng repo hoặc ở
một thư mục khác. Root của app phải có `pubspec.yaml` và thường có `lib/`; root
toolkit phải có `tools/flutter-mcp-server/dist/index.js` sau khi build server.

Kiểm tra máy trước khi cài:

```powershell
node --version
flutter --version
flutter doctor -v
```

Với Android, kiểm tra thêm `adb version` và `adb devices -l`. Với iPhone/iPad
thật, MCP phải chạy trên macOS có Xcode; thiết bị phải trust máy Mac, bật
Developer Mode, project phải ký được app và có scheme XCUITest được share.

## What You Get

English:

- A canonical Flutter QA Agent Skill for Claude Code, Codex, and Antigravity.
- A local Model Context Protocol (MCP) server for Flutter, Dart VM Service,
  Android ADB, and macOS/iOS workflows.
- Cross-platform installer scripts for project-local and global installs.
- A deterministic Flutter fixture for responsive and overflow verification.

Tiếng Việt:

- Một Flutter QA Agent Skill chuẩn cho Claude Code, Codex, và Antigravity.
- Một MCP server cục bộ cho Flutter, Dart VM Service, Android ADB, và luồng
  macOS/iOS.
- Script cài đặt đa nền tảng cho phạm vi project và global.
- Một Flutter fixture ổn định để kiểm tra responsive và overflow.

## Repository Map

| Path | Purpose |
|---|---|
| `.claude/skills/flutter-qa-engineer/` | Canonical Claude Code skill source |
| `.agents/skills/flutter-qa-engineer/` | Shared skill location for Codex and Antigravity |
| `tools/flutter-mcp-server/` | Standalone MCP server implementation |
| `tools/install-flutter-qa-skill.mjs` | Cross-agent installer and verifier |
| `scripts/` | PowerShell and shell wrappers for the installer |
| `docs/AGENT_INSTALLATION.md` | Compact installation runbook |
| `tools/flutter-mcp-server/README.md` | Server-specific MCP reference |
| `examples/flutter_fixture/` | Deterministic Flutter smoke fixture |
| `COMPATIBILITY.md` | Supported toolchain and platform baseline |
| `SECURITY.md` | Security boundaries and opt-in gates |

Tiếng Việt: Bảng này giúp phân biệt file skill, MCP server, installer, fixture,
và các tài liệu liên quan.

## Supported Baselines

| Component | Supported baseline | Notes |
|---|---:|---|
| Node.js | 18.18+ | Used by the MCP server and installer |
| Flutter/Dart | Flutter 3.29+, Dart 3.7+ | Fixture has no third-party dependencies |
| MCP transport | Stdio | Works with Claude Code, Codex, and compatible MCP hosts |
| Skill hosts | Claude Code, Codex, Antigravity IDE/CLI | Skill discovery uses `.claude/skills` and `.agents/skills` |
| Android automation | Any host with Flutter + ADB | Device mutations are opt-in |
| iOS/macOS automation | macOS with Xcode 16+ | Uses `xcrun devicectl`, XCUITest, and `xcresulttool` |

Tiếng Việt: Windows dùng tốt cho phần Flutter/ADB, nhưng automation iPhone/iPad
thật là macOS-only vì phụ thuộc vào Xcode và tool của Apple.

For the full compatibility matrix, read [COMPATIBILITY.md](COMPATIBILITY.md).

## Quick Start

### 1) Install the skill and MCP config

English:

Project-local install is the recommended default when you are adding this kit
to an existing Flutter repository.

```powershell
node tools/install-flutter-qa-skill.mjs `
  --scope project `
  --agents all `
  --configure-mcp
```

This installs the canonical skill into:

- Claude Code: `.claude/skills/flutter-qa-engineer`
- Codex / Antigravity: `.agents/skills/flutter-qa-engineer`

It also writes or merges the MCP config files:

- `.mcp.json`
- `.claude/mcp-config.json`
- `.agents/mcp_config.json`

If the Flutter app is in a different directory, run the same installer with
an explicit project root. The command below is executable after replacing the
two paths with the real toolkit and app locations:

```powershell
node C:/path/to/flutter-qa-kit/tools/install-flutter-qa-skill.mjs `
  --project-root C:/path/to/my-flutter-app `
  --scope project `
  --agents all `
  --configure-mcp
```

On macOS/Linux:

```bash
node /path/to/flutter-qa-kit/tools/install-flutter-qa-skill.mjs \
  --project-root /path/to/my-flutter-app \
  --scope project \
  --agents all \
  --configure-mcp
```

Tiếng Việt:

Install ở phạm vi project là lựa chọn mặc định an toàn nhất khi gắn bộ này vào
repo Flutter hiện tại.

```powershell
node tools/install-flutter-qa-skill.mjs `
  --scope project `
  --agents all `
  --configure-mcp
```

Lệnh này cài skill chuẩn vào:

- Claude Code: `.claude/skills/flutter-qa-engineer`
- Codex / Antigravity: `.agents/skills/flutter-qa-engineer`

Đồng thời nó ghi hoặc merge các file MCP config:

- `.mcp.json`
- `.claude/mcp-config.json`
- `.agents/mcp_config.json`

English:

If you want reusable global copies as well, run:

```powershell
node tools/install-flutter-qa-skill.mjs `
  --scope all `
  --agents all `
  --configure-mcp
```

The installer is idempotent. It refuses to overwrite a different skill unless
you pass `--force`, and it can verify or uninstall existing copies.

Tiếng Việt:

Nếu muốn cả bản global để dùng lại ở mọi workspace, chạy:

```powershell
node tools/install-flutter-qa-skill.mjs `
  --scope all `
  --agents all `
  --configure-mcp
```

Installer có tính idempotent. Nó không ghi đè skill khác nếu không có
`--force`, và có thể verify hoặc uninstall bản đã cài.

Wrapper scripts are available too:

```powershell
.\scripts\install-skill.ps1 --scope project --agents all --configure-mcp
```

```bash
bash scripts/install-skill.sh --scope project --agents all --configure-mcp
```

The wrappers must be run from the toolkit root. For an app in another
directory, use the Node command above or pass the app root through the
wrapper's forwarded arguments.

Tiếng Việt:

Nếu app Flutter nằm ở thư mục khác, truyền `--project-root` như các ví dụ
trên. Lệnh sẽ copy Skill vào app, tạo cấu hình MCP theo đúng root của app, và
vẫn chạy MCP server từ toolkit. Có thể dùng PowerShell hoặc shell POSIX; các
wrapper cần được gọi từ root toolkit.

### 2) Build and verify the MCP server

English:

From the repository root:

```powershell
npm ci --prefix tools/flutter-mcp-server
npm run build --prefix tools/flutter-mcp-server
npm test --prefix tools/flutter-mcp-server
npm run validate:skill --prefix tools/flutter-mcp-server
```

For a full local check of the server package, run:

```powershell
npm run check --prefix tools/flutter-mcp-server
```

The MCP server must be built before any agent starts it. If the toolkit is
installed into an external Flutter app, run these commands in the toolkit
checkout, not in the app checkout. `FLUTTER_PROJECT_ROOT` will still point at
the app when the installer writes the external project's MCP entry.

For release-grade dependency and package checks:

```powershell
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
```

If you want to validate the bundled fixture too, install Flutter packages for
the fixture first:

```powershell
Push-Location examples/flutter_fixture
flutter pub get
Pop-Location
npm run test:fixture --prefix tools/flutter-mcp-server
```

Tiếng Việt:

Từ thư mục gốc repo:

```powershell
npm ci --prefix tools/flutter-mcp-server
npm run build --prefix tools/flutter-mcp-server
npm test --prefix tools/flutter-mcp-server
npm run validate:skill --prefix tools/flutter-mcp-server
```

Để kiểm tra đầy đủ package server local, chạy:

```powershell
npm run check --prefix tools/flutter-mcp-server
```

Nếu muốn kiểm tra cả fixture đi kèm, hãy cài Flutter package cho fixture trước:

```powershell
Push-Location examples/flutter_fixture
flutter pub get
Pop-Location
npm run test:fixture --prefix tools/flutter-mcp-server
```

Server phải được build ở checkout của toolkit trước khi agent khởi động. Nếu
app ở repo khác, vẫn chạy các lệnh Node này trong toolkit; installer sẽ đặt
`FLUTTER_PROJECT_ROOT` về root của app.

### 3) Configure your agent

English:

Claude Code can load the project MCP file directly:

```powershell
claude --mcp-config .claude/mcp-config.json
```

The standalone template is also available at
[`tools/flutter-mcp-server/mcp-config.example.json`](tools/flutter-mcp-server/mcp-config.example.json).

For the auto-discovered project server, run `claude mcp list` and approve
`flutter-qa` when Claude Code shows it as **Pending approval**. The project
`.mcp.json` is intentionally ignored by Git because it contains machine-local
paths; `.claude/mcp-config.json` is the shareable template.

If the app is external, start Claude Code in the app root (where the installer
created `.claude/`) or pass the generated config with its absolute path.

Claude Desktop usually reads `%APPDATA%\Claude\claude_desktop_config.json`.
Copy the `mcpServers.flutter-qa` entry there and replace
`${CLAUDE_PROJECT_DIR:-.}` with an absolute Flutter project path.

Tiếng Việt:

Claude Code có thể nạp trực tiếp file MCP của project:

```powershell
claude --mcp-config .claude/mcp-config.json
```

Claude Desktop thường đọc `%APPDATA%\Claude\claude_desktop_config.json`.
Hãy copy mục `mcpServers.flutter-qa` vào đó và thay `${CLAUDE_PROJECT_DIR:-.}`
bằng đường dẫn tuyệt đối của Flutter project.

English:

Codex uses its own MCP registry. When the toolkit and Flutter app are the same
checkout, run this from the project root:

```powershell
$root = (Get-Location).Path
$server = Join-Path $root 'tools/flutter-mcp-server/dist/index.js'
codex mcp add flutter-qa `
  --env "FLUTTER_PROJECT_ROOT=$root" `
  --env FLUTTER_MCP_TIMEOUT_MS=120000 `
  --env FLUTTER_MCP_ALLOW_ADB_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_IOS_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=0 `
  -- node $server
codex mcp list
```

For an app in a different checkout, keep `$root` pointed at the app and point
`$server` at the built toolkit server:

```powershell
$root = (Resolve-Path 'C:/path/to/my-flutter-app').Path
$server = 'C:/path/to/flutter-qa-kit/tools/flutter-mcp-server/dist/index.js'
codex mcp add flutter-qa `
  --env "FLUTTER_PROJECT_ROOT=$root" `
  --env FLUTTER_MCP_TIMEOUT_MS=120000 `
  --env FLUTTER_MCP_ALLOW_ADB_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_IOS_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=0 `
  -- node $server
codex mcp list
```

The same registry is shared by Codex CLI, the Codex desktop app, and the IDE
extension. If your workflow is managed through TOML instead of the CLI, put
the equivalent entry in `~/.codex/config.toml` (or a trusted project-local
`.codex/config.toml`):

```toml
[mcp_servers.flutter-qa]
command = "node"
args = ["/absolute/path/to/flutter-qa-kit/tools/flutter-mcp-server/dist/index.js"]
cwd = "/absolute/path/to/my-flutter-app"
startup_timeout_sec = 20
tool_timeout_sec = 120

[mcp_servers.flutter-qa.env]
FLUTTER_PROJECT_ROOT = "/absolute/path/to/my-flutter-app"
FLUTTER_MCP_TIMEOUT_MS = "120000"
FLUTTER_MCP_ALLOW_ADB_MUTATIONS = "0"
FLUTTER_MCP_ALLOW_IOS_MUTATIONS = "0"
FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE = "0"
```

Replace the two absolute paths before saving the TOML file. Keep user-level
`config.toml` private when it contains local paths or other personal settings.

Tiếng Việt:

Codex dùng MCP registry riêng. Nếu toolkit và app ở cùng checkout, chạy từ
root project:

```powershell
$root = (Get-Location).Path
$server = Join-Path $root 'tools/flutter-mcp-server/dist/index.js'
codex mcp add flutter-qa `
  --env "FLUTTER_PROJECT_ROOT=$root" `
  --env FLUTTER_MCP_TIMEOUT_MS=120000 `
  --env FLUTTER_MCP_ALLOW_ADB_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_IOS_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=0 `
  -- node $server
codex mcp list
```

Nếu app ở checkout khác, giữ `$root` là root app và đặt `$server` trỏ đến
server đã build trong toolkit như ví dụ English ở trên.

English:

Antigravity reads `.agents/mcp_config.json`. The installer can generate that
file automatically with `--configure-mcp`.

The project Skill is discovered from `.agents/skills/flutter-qa-engineer`.
For a global install, the installer also supports the Antigravity IDE path
`~/.gemini/config/skills/flutter-qa-engineer` and the legacy CLI path
`~/.gemini/antigravity-cli/skills/flutter-qa-engineer`.

Tiếng Việt:

Antigravity đọc `.agents/mcp_config.json`. Installer có thể tự sinh file này
khi dùng `--configure-mcp`.

Skill trong project nằm ở `.agents/skills/flutter-qa-engineer`; installer cũng
hỗ trợ thư mục global của Antigravity IDE và CLI như trong runbook cài đặt.

### 4) Restart the agent and invoke the skill

English:

After install or config changes, restart the agent so it rescans skills and
MCP servers. Then invoke the skill with one of the supported triggers:

- `qa feature`
- `test flutter`
- `check overflow`

You can also run it by name:

- Claude Code: `/flutter-qa-engineer`
- Codex: `$flutter-qa-engineer` or `/skills`
- Antigravity: `/flutter-qa-engineer`

An effective first prompt is:

```text
qa feature
Read docs/features/<feature>.md, inspect the related lib/ code, build the
happy-path/edge/error/validation matrix, run the responsive overflow guard,
and return the evidence report. Do not use a real device unless I authorize it.
```

The agent should then inspect the specification before editing tests. It may
repair a demonstrated product defect in `lib/` or a test/harness defect when
the host permissions and the requested scope allow edits; it must report an
environment blocker instead of hiding it with a skipped test.

Tiếng Việt:

Sau khi cài hoặc đổi cấu hình, hãy restart agent để nó quét lại skills và MCP
servers. Sau đó gọi skill bằng một trong các trigger được hỗ trợ:

- `qa feature`
- `test flutter`
- `check overflow`

Bạn cũng có thể gọi trực tiếp theo tên:

- Claude Code: `/flutter-qa-engineer`
- Codex: `$flutter-qa-engineer` hoặc `/skills`
- Antigravity: `/flutter-qa-engineer`

Ví dụ prompt mở đầu:

```text
qa feature
Đọc docs/features/<feature>.md, quét phần lib/ liên quan, lập ma trận
happy-path/edge/error/validation, chạy overflow guard responsive và trả về
báo cáo bằng chứng. Không dùng thiết bị thật nếu tôi chưa cấp quyền.
```

## What the Skill Does

English:

The skill runs a strict QA loop:

1. Ingest the spec/doc and inspect the relevant `lib/` slice.
2. Plan test cases for happy path, edge cases, network/API failures, and form
   validation.
3. Generate or repair unit tests and widget tests.
4. Enforce responsive coverage across `320x568`, `390x844`, and landscape,
   plus `textScaleFactor = 1.5`.
5. Read failures, classify them as product bugs or test bugs, and iterate until
   the suite passes or the real blocker is identified.

Tiếng Việt:

Skill sẽ chạy một vòng QA nghiêm ngặt:

1. Đọc spec/doc và quét phần `lib/` liên quan.
2. Lập test case cho happy path, edge cases, lỗi network/API, và validation.
3. Sinh hoặc sửa unit test và widget test.
4. Bắt buộc kiểm tra responsive ở `320x568`, `390x844`, và landscape, kèm
   `textScaleFactor = 1.5`.
5. Đọc lỗi, phân loại là bug của product hay bug của test, rồi lặp cho đến khi
   pass hoặc tìm ra blocker thật.

## What the MCP Server Does

English:

The server exposes ten bounded tools:

- `run_flutter_tests`
- `analyze_code`
- `query_vm_service`
- `check_layout_overflow`
- `run_adb_command`
- `list_ios_devices`
- `run_ios_integration_tests`
- `run_xcuitests`
- `ios_app_control`
- `inspect_xcresult`

Quick reference:

| Tool | Primary use | Default mutation state |
|---|---|---|
| `run_flutter_tests` | Focused file or full Flutter test run with parsed counts and overflow lines | Read-only |
| `analyze_code` | Structured `flutter analyze` diagnostics | Read-only |
| `query_vm_service` | Read-only Dart VM Service inspection | Loopback only |
| `check_layout_overflow` | Runtime breakpoint matrix plus static layout-risk scan | Read-only |
| `run_adb_command` | Android devices, screenshots, crash logcat, optional tap/type | Tap/type gated |
| `list_ios_devices` | Explicit physical iPhone/iPad discovery via `devicectl` | Read-only |
| `run_ios_integration_tests` | Flutter `integration_test` on one selected iOS device | iOS gate |
| `run_xcuitests` | Native XCTest/XCUITest on one selected iOS device | iOS gate |
| `ios_app_control` | Bounded install, launch, or terminate through `devicectl` | iOS gate |
| `inspect_xcresult` | Parse an existing `.xcresult` bundle | Read-only |

Typical MCP calls (the host sends these JSON arguments to the named tool):

```json
{
  "tool": "analyze_code",
  "arguments": { "cwd": ".", "format": "machine" }
}
```

```json
{
  "tool": "run_flutter_tests",
  "arguments": {
    "testPath": "test/features/example/example_test.dart",
    "coverage": false
  }
}
```

```json
{
  "tool": "check_layout_overflow",
  "arguments": {
    "testPath": "test/features/example/example_widget_test.dart",
    "mode": "both",
    "textScales": [1, 1.5]
  }
}
```

Tiếng Việt:

Server cung cấp 10 tool có giới hạn rõ ràng:

- `run_flutter_tests`
- `analyze_code`
- `query_vm_service`
- `check_layout_overflow`
- `run_adb_command`
- `list_ios_devices`
- `run_ios_integration_tests`
- `run_xcuitests`
- `ios_app_control`
- `inspect_xcresult`

Bảng trên cho biết tool nào chỉ đọc và tool nào cần mở mutation gate. Agent
nên gọi `analyze_code` trước, chạy test tập trung, chạy `check_layout_overflow`,
rồi mới chạy toàn bộ suite. Các JSON mẫu là payload gửi qua MCP, không phải
lệnh shell độc lập.

English:

The important safety rules are:

- Android `tap` and `input_text` are disabled unless
  `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1`.
- iOS device mutations and XCUITest execution are disabled unless
  `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1`.
- Remote VM Service access is disabled unless
  `FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1`.
- `list_ios_devices` is read-only and uses `xcrun devicectl`.
- `inspect_xcresult` is read-only and expects an existing project-local
  `.xcresult` bundle.

Tiếng Việt:

Các quy tắc an toàn quan trọng:

- `tap` và `input_text` của Android bị khóa nếu chưa bật
  `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1`.
- Các thao tác đổi trạng thái iOS và chạy XCUITest bị khóa nếu chưa bật
  `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1`.
- Remote VM Service bị khóa nếu chưa bật
  `FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1`.
- `list_ios_devices` chỉ đọc và chạy qua `xcrun devicectl`.
- `inspect_xcresult` chỉ đọc và cần một `.xcresult` có sẵn trong project.

## Android Workflow

English:

Use Android ADB tools when you need device discovery, screenshots, crash log
collection, or controlled input on an emulator or attached device.

Typical tool calls:

```json
{
  "tool": "run_adb_command",
  "arguments": {
    "operation": "devices"
  }
}
```

```json
{
  "tool": "run_adb_command",
  "arguments": {
    "operation": "screencap",
    "outputPath": ".artifacts/android/screen.png"
  }
}
```

```json
{
  "tool": "run_adb_command",
  "arguments": {
    "operation": "logcat_crash",
    "lines": 200
  }
}
```

To allow mutation operations during an authorized session only:

```powershell
$env:FLUTTER_MCP_ALLOW_ADB_MUTATIONS = "1"
```

Tiếng Việt:

Hãy dùng ADB khi cần khám phá thiết bị, chụp màn hình, lấy crash log, hoặc
điều khiển input có kiểm soát trên emulator / thiết bị đang kết nối.

Ví dụ tool call:

```json
{
  "tool": "run_adb_command",
  "arguments": {
    "operation": "devices"
  }
}
```

```json
{
  "tool": "run_adb_command",
  "arguments": {
    "operation": "screencap",
    "outputPath": ".artifacts/android/screen.png"
  }
}
```

```json
{
  "tool": "run_adb_command",
  "arguments": {
    "operation": "logcat_crash",
    "lines": 200
  }
}
```

Chỉ bật mutate trong phiên đã được cho phép:

```powershell
$env:FLUTTER_MCP_ALLOW_ADB_MUTATIONS = "1"
```

## macOS and Physical iOS Devices

English:

Run the MCP server on macOS with the active Xcode installation. Before asking
the agent to drive a real device, verify the toolchain and the connected
device:

```bash
xcode-select -p
xcrun devicectl list devices
flutter devices
```

Use `list_ios_devices` for read-only discovery. It does not mutate the device
and does not guess a fallback phone or tablet.

For native UI, permission dialogs, or other system-owned surfaces, use XCUITest
through `run_xcuitests`. For Flutter app flows on a selected iOS device, use
`run_ios_integration_tests`. For bounded app install/launch/terminate, use
`ios_app_control`.

Physical-device prerequisites are stricter than simulator or widget tests:

- The device is trusted by the Mac and has Developer Mode enabled.
- The Flutter iOS Runner target builds and signs for that device.
- Native XCUITest runs have a valid XCTest target and a shared Xcode scheme.
- The selected project can write a new `.xcresult` bundle under an ignored,
  project-local artifact directory.
- The agent receives an explicit device identifier from `list_ios_devices`;
  it must never silently switch to another connected device.

Example evidence sequence:

```text
list_ios_devices
run_ios_integration_tests (Flutter-owned flow)
or run_xcuitests (native/system-owned flow)
inspect_xcresult (read-only result inspection)
```

Enable iOS mutation mode only for the authorized session:

```bash
export FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1
```

When the session ends, unset the variable and restart the MCP process so the
gate closes again:

```bash
unset FLUTTER_MCP_ALLOW_IOS_MUTATIONS
```

Tiếng Việt:

Hãy chạy MCP server trên macOS với Xcode đang được chọn làm developer
directory. Trước khi để agent điều khiển thiết bị thật, hãy kiểm tra toolchain
và thiết bị đang kết nối:

```bash
xcode-select -p
xcrun devicectl list devices
flutter devices
```

Dùng `list_ios_devices` cho bước khám phá chỉ đọc. Nó không thay đổi thiết bị
và cũng không tự đoán iPhone/iPad khác thay thế.

Với native UI, permission dialog, hoặc màn hình thuộc hệ thống, dùng XCUITest
qua `run_xcuitests`. Với luồng Flutter app trên thiết bị iOS đã chọn, dùng
`run_ios_integration_tests`. Với cài / mở / đóng app ở mức giới hạn, dùng
`ios_app_control`.

Điều kiện thiết bị thật chặt chẽ hơn widget test hoặc simulator: máy phải
trust Mac và bật Developer Mode; target Runner phải build/ký được; XCUITest
phải có XCTest target và scheme đã share; project phải ghi được `.xcresult`
vào thư mục artifact đã ignore; agent phải dùng đúng identifier trả về bởi
`list_ios_devices` và không được tự chuyển sang thiết bị khác.

Chỉ bật chế độ mutate iOS trong phiên được cấp phép:

```bash
export FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1
```

Khi phiên kết thúc, hãy unset biến này và restart MCP process để đóng gate lại:

```bash
unset FLUTTER_MCP_ALLOW_IOS_MUTATIONS
```

## Configuration Examples

### Claude Code / Claude Desktop

English:

Use `.claude/mcp-config.json` for Claude Code. For Claude Desktop, copy the
same `mcpServers.flutter-qa` entry into `%APPDATA%\Claude\claude_desktop_config.json`
and replace `${CLAUDE_PROJECT_DIR:-.}` with an absolute path.

```json
{
  "mcpServers": {
    "flutter-qa": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/flutter-qa-kit/tools/flutter-mcp-server/dist/index.js"],
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
```

Tiếng Việt:

Dùng `.claude/mcp-config.json` cho Claude Code. Với Claude Desktop, hãy copy
mục `mcpServers.flutter-qa` sang `%APPDATA%\Claude\claude_desktop_config.json`
và thay `${CLAUDE_PROJECT_DIR:-.}` bằng đường dẫn tuyệt đối.

### Codex

English:

Codex uses its own MCP registry. Register the server with an absolute entry
point. For a same-checkout setup:

```powershell
$root = (Get-Location).Path
$server = Join-Path $root 'tools/flutter-mcp-server/dist/index.js'
codex mcp add flutter-qa `
  --env "FLUTTER_PROJECT_ROOT=$root" `
  --env FLUTTER_MCP_TIMEOUT_MS=120000 `
  --env FLUTTER_MCP_ALLOW_ADB_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_IOS_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=0 `
  -- node $server
codex mcp list
```

For an external app, use the app as `$root` and the toolkit as `$server`, as
shown in the Quick Start section above.

Tiếng Việt:

Codex dùng MCP registry riêng. Hãy đăng ký server bằng entry point tuyệt đối;
nếu app ở repo khác, `$root` phải là root app còn `$server` phải trỏ đến
toolkit server đã build.

```powershell
$root = (Get-Location).Path
$server = Join-Path $root 'tools/flutter-mcp-server/dist/index.js'
codex mcp add flutter-qa `
  --env "FLUTTER_PROJECT_ROOT=$root" `
  --env FLUTTER_MCP_TIMEOUT_MS=120000 `
  --env FLUTTER_MCP_ALLOW_ADB_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_IOS_MUTATIONS=0 `
  --env FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=0 `
  -- node $server
codex mcp list
```

### Antigravity

English:

Antigravity reads `.agents/mcp_config.json`. The installer can generate that
file automatically with `--configure-mcp`.

Tiếng Việt:

Antigravity đọc `.agents/mcp_config.json`. Installer có thể tự sinh file này
khi dùng `--configure-mcp`.

## Public Release Checklist

English:

Before pushing this repository to GitHub:

```powershell
node tools/install-flutter-qa-skill.mjs --verify --scope project --agents all
npm run check --prefix tools/flutter-mcp-server
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
```

If this checkout has no Git history yet, review the staged file list before the
first commit:

```powershell
git init -b main
git add .
git diff --cached --check
git status --short
```

Create the remote and push only after the staged review is clean. This guide
does not initialize Git, create a remote, commit, or push on your behalf.

Also review these files for repository-specific secrets, internal paths, or
license wording:

- `README.md`
- `SECURITY.md`
- `COMPATIBILITY.md`
- `LICENSE`

Do not publish local runtime state or machine-specific configuration. Confirm
that `.mcp.json`, `.codex/config.toml`, `.skill-backups/`, `.artifacts/`,
`.dart_tool/`, `build/`, and `node_modules/` are ignored and absent from the
staged file list. Redact screenshots, logcat, VM Service output, and
`.xcresult` attachments before sharing them.

Tiếng Việt:

Trước khi đẩy repo lên GitHub:

```powershell
node tools/install-flutter-qa-skill.mjs --verify --scope project --agents all
npm run check --prefix tools/flutter-mcp-server
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
```

Nếu checkout chưa có lịch sử Git, hãy rà danh sách staged trước commit đầu
tiên bằng `git init -b main`, `git add .`, `git diff --cached --check` và
`git status --short`. Tài liệu này không tự init Git, tạo remote, commit hoặc
push thay bạn.

Cũng nên rà lại các file này để tìm secret, đường dẫn nội bộ, hoặc phần ghi
license cần chỉnh theo project của bạn:

- `README.md`
- `SECURITY.md`
- `COMPATIBILITY.md`
- `LICENSE`

Không public state local hoặc config theo máy. Kiểm tra `.mcp.json`,
`.codex/config.toml`, `.skill-backups/`, `.artifacts/`, `.dart_tool/`, `build/`
và `node_modules/` đều bị ignore và không nằm trong danh sách staged. Hãy
redact screenshot, logcat, VM Service output và attachment trong `.xcresult`.

## Troubleshooting

English:

- Skill does not show up: restart the agent, then verify the install paths.
- MCP server not visible: confirm the config file points to
  `tools/flutter-mcp-server/dist/index.js` and that `npm run build` has been
  run.
- Flutter commands fail: make sure `FLUTTER_BIN` points to a valid SDK or that
  `flutter` is on `PATH`.
- iOS tools fail on Windows/Linux: move the server to macOS with Xcode 16+.
- `tap` or `input_text` is rejected: set
  `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1` for the session.
- iOS device operations are rejected: set
  `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1` and restart the MCP process.

Tiếng Việt:

- Skill không xuất hiện: restart agent rồi kiểm tra lại đường dẫn cài đặt.
- MCP server không hiện: xác nhận file config trỏ đến
  `tools/flutter-mcp-server/dist/index.js` và đã chạy `npm run build`.
- Lệnh Flutter bị lỗi: kiểm tra `FLUTTER_BIN` hoặc `PATH` có Flutter SDK hợp lệ.
- Tool iOS lỗi trên Windows/Linux: hãy chuyển MCP server sang macOS với Xcode
  16+.
- `tap` hoặc `input_text` bị từ chối: bật
  `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1` cho đúng phiên đó.
- Các thao tác iOS bị từ chối: bật `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1` và
  restart MCP process.

## Related Docs

English:

- [Agent installation runbook](docs/AGENT_INSTALLATION.md)
- [Flutter MCP server README](tools/flutter-mcp-server/README.md)
- [Compatibility matrix](COMPATIBILITY.md)
- [Security notes](SECURITY.md)
- [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Codex Skills documentation](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Antigravity Agent Skills](https://antigravity.google/docs/skills/)

Tiếng Việt:

- [Runbook cài agent](docs/AGENT_INSTALLATION.md)
- [README của Flutter MCP server](tools/flutter-mcp-server/README.md)
- [Bảng tương thích](COMPATIBILITY.md)
- [Ghi chú bảo mật](SECURITY.md)
- [Tài liệu MCP của Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Tài liệu Skills của Codex](https://learn.chatgpt.com/docs/build-skills)
- [Tài liệu MCP của Claude Code](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Tài liệu Agent Skills của Antigravity](https://antigravity.google/docs/skills/)
