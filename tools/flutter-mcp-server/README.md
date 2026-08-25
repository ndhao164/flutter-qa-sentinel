# Flutter QA Sentinel MCP Server

This standalone MCP server gives an agent bounded access to Flutter, Dart VM
Service, Android ADB, and macOS/iOS tooling for QA work. It is designed to be
safe by default: device mutations and remote VM Service access stay disabled
until you explicitly opt in.

Tiếng Việt: Đây là MCP server độc lập cho phép agent truy cập có giới hạn vào
Flutter, Dart VM Service, Android ADB, và toolchain macOS/iOS để làm QA. Mặc
định server an toàn: các thao tác thay đổi thiết bị và remote VM Service đều
bị khóa cho tới khi bạn bật rõ ràng.

## Install / Cài đặt

English:

From the repository root:

```powershell
npm ci --prefix tools/flutter-mcp-server
npm run build --prefix tools/flutter-mcp-server
npm test --prefix tools/flutter-mcp-server
```

If you want the full verification bundle, run:

```powershell
npm run check --prefix tools/flutter-mcp-server
```

If Flutter or ADB is not on `PATH`, set the executable overrides in the
environment inherited by the MCP process:

```powershell
$env:FLUTTER_BIN = "C:\path\to\flutter\bin\flutter.bat"
$env:ADB_BIN = "C:\path\to\Android\Sdk\platform-tools\adb.exe"
```

On macOS/Linux, export the corresponding paths before launching the agent.

Tiếng Việt:

Từ thư mục gốc repository:

```powershell
npm ci --prefix tools/flutter-mcp-server
npm run build --prefix tools/flutter-mcp-server
npm test --prefix tools/flutter-mcp-server
```

Nếu muốn bộ kiểm tra đầy đủ, chạy thêm:

```powershell
npm run check --prefix tools/flutter-mcp-server
```

Nếu Flutter hoặc ADB không nằm trong `PATH`, hãy đặt `FLUTTER_BIN` và
`ADB_BIN` trong environment mà MCP process kế thừa trước khi mở agent.

## What the server exposes / Server cung cấp gì

English:

The server currently exposes ten tools:

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

Tiếng Việt:

Server hiện cung cấp 10 tool:

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

English:

The most important defaults are:

- `check_layout_overflow` runs across the responsive matrix
  `320x568`, `390x844`, and landscape, with text scale `1.5`.
- `run_adb_command` allows `devices`, `get_state`, `screencap`, `tap`,
  `input_text`, and `logcat_crash`.
- `list_ios_devices` is read-only and uses `xcrun devicectl`.
- `run_xcuitests` and `run_ios_integration_tests` are restricted to a selected
  physical iOS device.
- `ios_app_control` can install, launch, or terminate an app through a bounded
  `devicectl` adapter.

Tiếng Việt:

Các mặc định quan trọng nhất:

- `check_layout_overflow` chạy qua ma trận responsive
  `320x568`, `390x844`, và landscape, với text scale `1.5`.
- `run_adb_command` cho phép `devices`, `get_state`, `screencap`, `tap`,
  `input_text`, và `logcat_crash`.
- `list_ios_devices` là chỉ đọc và chạy qua `xcrun devicectl`.
- `run_xcuitests` và `run_ios_integration_tests` chỉ áp dụng cho một thiết bị
  iOS thật đã chọn.
- `ios_app_control` có thể cài, mở, hoặc đóng app qua adapter `devicectl`
  có giới hạn.

## Configuration / Cấu hình

### Claude Code / Claude Desktop

English:

Use `.claude/mcp-config.json` in Claude Code. For Claude Desktop, copy the
same `flutter-qa` entry into `%APPDATA%\Claude\claude_desktop_config.json` and
replace the project path with an absolute path.

The repository also includes a copy-ready template at
[`mcp-config.example.json`](mcp-config.example.json).

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

Dùng `.claude/mcp-config.json` cho Claude Code. Với Claude Desktop, copy cùng
mục `flutter-qa` sang `%APPDATA%\Claude\claude_desktop_config.json` và thay
đường dẫn project bằng đường dẫn tuyệt đối.

### Codex

English:

Codex uses its own MCP registry. Register the server with an absolute entry
point. If the app is outside this checkout, set `FLUTTER_PROJECT_ROOT` to the
app and pass the toolkit server's absolute path after `--`.

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
```

Tiếng Việt:

Codex dùng MCP registry riêng. Hãy đăng ký server bằng entry point tuyệt đối:

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
```

### Antigravity

English:

Antigravity reads `.agents/mcp_config.json`. The repository installer can
generate it automatically with `--configure-mcp`.

Tiếng Việt:

Antigravity đọc `.agents/mcp_config.json`. Installer trong repo có thể tự sinh
file này bằng `--configure-mcp`.

## iOS and Android safety / An toàn iOS và Android

English:

Android mutation tools are off unless `FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1`.
Remote VM Service access is off unless `FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1`.
On macOS, iOS device and XCUITest operations are off unless
`FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1`.

The iOS tools require macOS with Xcode 16+ and a trusted physical device with
Developer Mode enabled. The Flutter integration path also needs a buildable,
signed iOS Runner target. The native XCUITest path additionally needs a shared
Xcode scheme, a valid XCTest/XCUITest target, signing/provisioning that works
for the selected device, and a writable project-local result-bundle directory.
Those Apple project prerequisites are intentionally not changed by this
server.

Before a physical-device run, use the read-only discovery tool first and keep
the device identifier explicit:

```text
1. list_ios_devices
2. choose one returned device identifier
3. enable FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1 for the authorized session
4. run run_ios_integration_tests or run_xcuitests
5. inspect the returned .xcresult with inspect_xcresult
6. unset the gate and restart the MCP process
```

Tiếng Việt:

Tool thay đổi trạng thái Android bị tắt nếu chưa bật
`FLUTTER_MCP_ALLOW_ADB_MUTATIONS=1`. Remote VM Service bị tắt nếu chưa bật
`FLUTTER_MCP_ALLOW_REMOTE_VM_SERVICE=1`. Trên macOS, các thao tác iOS và
XCUITest bị tắt nếu chưa bật `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1`.

Tool iOS yêu cầu macOS với Xcode 16+ và một thiết bị thật đã trust, bật
Developer Mode. Luồng Flutter integration cần target Runner build/ký được;
luồng XCUITest native còn cần scheme đã share, XCTest/XCUITest target hợp lệ,
signing/provisioning dùng được cho thiết bị đã chọn, và thư mục project-local
để ghi result bundle. Server không tự thay đổi các thiết lập Apple này.

Trước khi chạy thiết bị thật, hãy discovery chỉ đọc trước, giữ nguyên
identifier đã chọn, bật gate trong đúng phiên được cấp quyền, chạy test, đọc
`.xcresult`, rồi unset gate và restart MCP process.

Không được tự chọn thiết bị dự phòng nếu identifier đã chọn biến mất; hãy
dừng và báo blocker môi trường để tránh chạy nhầm trên iPhone/iPad khác.

## Run flow / Luồng chạy

English:

The intended agent loop is:

1. `analyze_code`
2. focused `run_flutter_tests`
3. `check_layout_overflow`
4. full `run_flutter_tests`
5. optional Android or iOS evidence tools

Tiếng Việt:

Luồng agent mong muốn là:

1. `analyze_code`
2. `run_flutter_tests` với phạm vi hẹp
3. `check_layout_overflow`
4. `run_flutter_tests` toàn bộ
5. thêm tool Android hoặc iOS nếu cần bằng chứng bổ sung

## Troubleshooting / Xử lý sự cố

English:

- Build errors usually mean `npm ci` or `npm run build` has not been run.
- Flutter command failures usually mean `FLUTTER_BIN` or `PATH` is wrong.
- iOS tool failures on Windows/Linux mean you need to move the server to macOS.
- Rejected `tap` or `input_text` calls usually mean the Android mutation gate
  is still closed.
- Rejected iOS device calls usually mean the iOS mutation gate is still closed
  or the process was not restarted after changing it.

Tiếng Việt:

- Lỗi build thường là do chưa chạy `npm ci` hoặc `npm run build`.
- Lỗi lệnh Flutter thường là do `FLUTTER_BIN` hoặc `PATH` chưa đúng.
- Tool iOS lỗi trên Windows/Linux thường là vì cần chuyển server sang macOS.
- `tap` hoặc `input_text` bị từ chối thường là do gate mutate Android vẫn đóng.
- Tool iOS bị từ chối thường là do gate iOS chưa mở hoặc chưa restart process
  sau khi đổi biến môi trường.

## More details / Xem thêm

English:

See the root [README](../../README.md) for the full A-to-Z setup guide, agent
installation workflow, and public-release checklist.

Tiếng Việt:

Xem [README gốc](../../README.md) để có hướng dẫn setup A-Z đầy đủ, quy trình
cài agent, và checklist trước khi public.
