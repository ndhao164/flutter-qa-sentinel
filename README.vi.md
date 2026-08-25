# Flutter QA Sentinel

[English](README.md) · **Tiếng Việt**

[![CI](https://github.com/ndhao164/flutter-qa-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/ndhao164/flutter-qa-sentinel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Flutter QA Sentinel là bộ Agent Skill và MCP tooling giúp agent AI thực hiện
QA Flutter theo spec một cách có kiểm soát. Repository này là toolkit/template,
không phải một ứng dụng Flutter hoàn chỉnh; nó không chứa `pubspec.yaml`,
`lib/` hoặc bộ test riêng của một app cụ thể.

Repository: [github.com/ndhao164/flutter-qa-sentinel](https://github.com/ndhao164/flutter-qa-sentinel)

## Mục lục

- [Lộ trình A-Z](#lo-trinh-a-z)
- [Điều kiện trước khi bắt đầu](#dieu-kien-truoc-khi-bat-dau)
- [Cài đặt nhanh](#cai-dat-nhanh)
- [Skill thực hiện gì](#skill-thuc-hien-gi)
- [MCP server cung cấp gì](#mcp-server-cung-cap-gi)
- [Android/ADB](#android-adb)
- [macOS và iOS thật](#macos-va-ios-that)
- [Checklist public GitHub](#checklist-public-github)
- [Xử lý sự cố](#xu-ly-su-co)

<a id="lo-trinh-a-z"></a>
## Lộ trình A-Z

1. Chuẩn bị Node.js, Flutter và tool Android/Apple nếu cần.
2. Cài Skill vào project và/hoặc thư mục global của agent.
3. Build MCP server và chạy bộ kiểm tra.
4. Đăng ký MCP với Claude Code, Codex hoặc Antigravity.
5. Restart agent, gọi `flutter-qa-engineer` và chạy SOP QA năm bước.
6. Chỉ chạy thao tác trên thiết bị thật khi phiên đã được cấp quyền.
7. Chạy checklist release trước khi public hoặc phát hành bản mới.

<a id="dieu-kien-truoc-khi-bat-dau"></a>
## Điều kiện trước khi bắt đầu

- Node.js 18.18 trở lên.
- Flutter SDK trên `PATH`, hoặc đặt `FLUTTER_BIN` cho MCP process.
- Android Platform Tools (`adb`) nếu test Android.
- macOS với Xcode 16+, `xcrun devicectl`, signing/provisioning và thiết bị
  iOS đã trust + bật Developer Mode nếu test iPhone/iPad thật.

```powershell
node --version
flutter --version
flutter doctor -v
```

Android:

```powershell
adb version
adb devices -l
```

Nếu tool không nằm trên `PATH`:

```powershell
$env:FLUTTER_BIN = "C:\path\to\flutter\bin\flutter.bat"
$env:ADB_BIN = "C:\path\to\Android\Sdk\platform-tools\adb.exe"
```

Với iOS thật, ngoài thiết bị trusted và Developer Mode, target Runner phải
build/ký được cho thiết bị; XCUITest cần XCTest target và shared Xcode scheme.

## Bản đồ repository

| Đường dẫn | Mục đích |
|---|---|
| `.claude/skills/flutter-qa-engineer/` | Skill canonical cho Claude Code |
| `.agents/skills/flutter-qa-engineer/` | Skill project-local cho Codex/Antigravity |
| `tools/flutter-mcp-server/` | MCP server độc lập |
| `tools/install-flutter-qa-skill.mjs` | Installer/verification đa agent |
| `scripts/` | Wrapper PowerShell và POSIX |
| `docs/AGENT_INSTALLATION.md` | Runbook cài đặt |
| `examples/flutter_fixture/` | Flutter fixture kiểm tra responsive |
| `COMPATIBILITY.md` | Ma trận tương thích |
| `SECURITY.md` | Ranh giới bảo mật và mutation gates |

<a id="cai-dat-nhanh"></a>
## Cài đặt nhanh

### Cài project-local

Chạy từ root của toolkit:

```powershell
node tools/install-flutter-qa-skill.mjs `
  --scope project `
  --agents all `
  --configure-mcp
```

Wrapper tương đương:

```powershell
.\scripts\install-skill.ps1 --scope project --agents all --configure-mcp
```

```bash
bash scripts/install-skill.sh --scope project --agents all --configure-mcp
```

Nếu app Flutter nằm ở repository khác:

```powershell
node C:/path/to/flutter-qa-sentinel/tools/install-flutter-qa-skill.mjs `
  --project-root C:/path/to/my-flutter-app `
  --scope project `
  --agents all `
  --configure-mcp
```

Installer sẽ copy Skill vào:

- Claude Code: `.claude/skills/flutter-qa-engineer`
- Codex/Antigravity: `.agents/skills/flutter-qa-engineer`

Và tạo/merge các file MCP project-local:

- `.mcp.json`
- `.claude/mcp-config.json`
- `.agents/mcp_config.json`

### Cài global

```powershell
node tools/install-flutter-qa-skill.mjs --scope global --agents all
```

Hoặc cài cả project và global:

```powershell
node tools/install-flutter-qa-skill.mjs --scope all --agents all --configure-mcp
```

Đích global mặc định:

| Agent | Thư mục |
|---|---|
| Claude Code | `~/.claude/skills/flutter-qa-engineer` |
| Codex | `$CODEX_HOME/skills/flutter-qa-engineer` hoặc `~/.codex/skills/flutter-qa-engineer` |
| Antigravity IDE | `~/.gemini/config/skills/flutter-qa-engineer` |
| Antigravity CLI | `~/.gemini/antigravity-cli/skills/flutter-qa-engineer` |

### Quản lý vòng đời an toàn

```powershell
# Xác minh, không thay đổi file
node tools/install-flutter-qa-skill.mjs --verify --scope all --agents all

# Xem trước, không ghi file
node tools/install-flutter-qa-skill.mjs --dry-run --scope all --agents all

# Backup rồi thay bản khác
node tools/install-flutter-qa-skill.mjs --force --scope all --agents all

# Gỡ chỉ những bản khớp Skill canonical
node tools/install-flutter-qa-skill.mjs --uninstall --scope all --agents all
```

Installer idempotent và không tự ghi đè bản khác nếu thiếu `--force`.

## Build và verify MCP server

```powershell
npm ci --prefix tools/flutter-mcp-server
npm run check --prefix tools/flutter-mcp-server
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
```

Kiểm tra fixture:

```powershell
Push-Location examples/flutter_fixture
flutter pub get
flutter analyze
flutter test
Pop-Location
npm run test:fixture --prefix tools/flutter-mcp-server
```

## Cấu hình theo agent

### Claude Code

```powershell
claude --mcp-config .claude/mcp-config.json
claude mcp list
```

Nếu server project hiện **Pending approval**, hãy approve trong Claude Code rồi
restart session. Với app ở repo khác, chạy Claude từ root của app hoặc truyền
đường dẫn tuyệt đối tới config được installer tạo.

### Codex

Codex dùng MCP registry riêng. Từ root project:

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

Sau đó restart Codex và dùng `/skills`, `$flutter-qa-engineer` hoặc `/mcp`.

### Antigravity IDE/CLI

Installer tạo `.agents/skills/flutter-qa-engineer` và
`.agents/mcp_config.json`. Reload workspace, mở `/skills` và `/mcp`. Global
install hỗ trợ cả đường dẫn IDE và CLI legacy ở bảng trên.

## Gọi Skill

Các trigger:

- `qa feature`
- `test flutter`
- `check overflow`

Hoặc gọi trực tiếp:

- Claude Code/Antigravity: `/flutter-qa-engineer`
- Codex: `$flutter-qa-engineer` hoặc `/skills`

Prompt mẫu:

```text
qa feature
Đọc spec, quét lib/, lập ma trận happy path/edge/error/validation,
chạy responsive overflow guard và trả về báo cáo bằng chứng.
Không dùng thiết bị thật nếu tôi chưa cấp quyền.
```

<a id="skill-thuc-hien-gi"></a>
## Skill thực hiện gì

Skill chạy SOP năm bước:

1. **Ingestion:** đọc spec và quét Widget, State, Repository trong `lib/`.
2. **Matrix Planning:** lập case happy path, edge case, network/API error và
   form validation.
3. **Test Suite Generation:** tạo/sửa unit test và widget test với injection
   Provider, Riverpod, Bloc, Mockito hoặc Mocktail phù hợp.
4. **Responsive & Overflow Guard:** bắt buộc chạy `320x568`, `390x844`,
   landscape `844x390`, text scale `1.5` và bắt lỗi `RenderFlex overflowed`.
5. **Self-healing loop:** phân loại lỗi feature/test/environment, sửa có kiểm
   soát và lặp đến khi pass hoặc báo blocker thật.

Template widget test canonical:
`.claude/skills/flutter-qa-engineer/prompts/widget_test_template.md`.

<a id="mcp-server-cung-cap-gi"></a>
## MCP server cung cấp gì

| Tool | Mục đích | Mặc định |
|---|---|---|
| `run_flutter_tests` | Chạy test, parse pass/fail/stack trace/overflow | Chỉ đọc |
| `analyze_code` | Parse diagnostics của `flutter analyze` | Chỉ đọc |
| `query_vm_service` | Inspect Dart VM Service | Loopback |
| `check_layout_overflow` | Runtime breakpoint matrix + static scan | Chỉ đọc |
| `run_adb_command` | Devices, screenshot, logcat, tap/type | Tap/type cần gate |
| `list_ios_devices` | Discovery iPhone/iPad qua `devicectl` | Chỉ đọc |
| `run_ios_integration_tests` | Flutter `integration_test` trên iOS thật | iOS gate |
| `run_xcuitests` | XCTest/XCUITest native | iOS gate |
| `ios_app_control` | Install/launch/terminate giới hạn | iOS gate |
| `inspect_xcresult` | Đọc `.xcresult` hiện có | Chỉ đọc |

Safety gates:

- Android `tap`/`input_text` cần `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1`.
- iOS test/device mutation cần `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1`.
- VM Service remote cần `FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1`.
- `list_ios_devices` và `inspect_xcresult` vẫn chỉ đọc.

<a id="android-adb"></a>
## Android/ADB

Ví dụ payload MCP:

```json
{
  "tool": "run_adb_command",
  "arguments": { "operation": "devices" }
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

Chỉ bật mutation trong phiên đã được cấp quyền:

```powershell
$env:FLUTTER_MCP_ALLOW_ADB_MUTATIONS = "1"
```

Screenshot và logcat có thể chứa dữ liệu cá nhân; giữ trong thư mục ignored và
redact trước khi chia sẻ.

<a id="macos-va-ios-that"></a>
## macOS và iOS thật

MCP iOS phải chạy trên macOS có Xcode:

```bash
xcode-select -p
xcodebuild -version
xcrun devicectl list devices
flutter devices
```

Luồng an toàn:

1. Gọi `list_ios_devices`.
2. Chọn chính xác một `deviceId` trả về.
3. Bật `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1` trong phiên được cấp quyền.
4. Dùng `run_ios_integration_tests` cho UI Flutter.
5. Dùng `run_xcuitests` cho native UI, permission dialog hoặc system UI.
6. Dùng `inspect_xcresult` để đọc kết quả.
7. Unset gate và restart MCP process.

Không được tự chuyển sang thiết bị khác nếu identifier đã chọn biến mất.
Signing, provisioning, scheme và Developer Mode là trách nhiệm của project
Apple; server không tự thay đổi chúng.

<a id="checklist-public-github"></a>
## Checklist public GitHub

```powershell
node tools/install-flutter-qa-skill.mjs --verify --scope project --agents all
npm run check --prefix tools/flutter-mcp-server
npm audit --audit-level=moderate --prefix tools/flutter-mcp-server
npm run pack:check --prefix tools/flutter-mcp-server
git diff --cached --check
git status --short
```

Không public `.mcp.json`, `.codex/config.toml`, `.skill-backups/`,
`.artifacts/`, `.dart_tool/`, `build/` hoặc `node_modules/`. Redact screenshot,
logcat, VM Service output và attachment `.xcresult`.

Hãy review cả `README.md` và `README.vi.md`, cùng với `SECURITY.md`,
`COMPATIBILITY.md`, license, audit output và các file `dist/` được generate.

<a id="xu-ly-su-co"></a>
## Xử lý sự cố

- Skill không xuất hiện: restart agent và chạy `--verify`.
- MCP không hiện: build lại `dist/index.js`, kiểm tra config và `PATH`.
- `tap`/`input_text` bị từ chối: mở Android mutation gate trong đúng session.
- iOS bị từ chối: chạy trên macOS, chọn device rõ ràng, mở iOS gate rồi restart
  MCP process.
- Overflow: giữ assertion, sửa constraint/layout hoặc fixture sau khi phân loại
  lỗi; không dùng `skip` để làm xanh test.

## Tài liệu liên quan

- [English README](README.md)
- [Agent installation runbook](docs/AGENT_INSTALLATION.md)
- [MCP server README](tools/flutter-mcp-server/README.md)
- [Compatibility](COMPATIBILITY.md)
- [Security](SECURITY.md)
- [Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Antigravity Skills docs](https://antigravity.google/docs/skills/)
