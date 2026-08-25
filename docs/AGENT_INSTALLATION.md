# Agent Skill Installation

English is the primary language. The Vietnamese note follows each operational
section so this file can be used as a compact, bilingual runbook.

**Vietnamese:** English là ngôn ngữ chính; phần tiếng Việt được đặt ngay sau
mỗi mục thao tác để làm runbook dùng chung cho cả team.

## 1. Prerequisites / Điều kiện trước khi cài

English:

- Node.js 18.18 or newer.
- A Flutter SDK available as `flutter` on `PATH` (or configure `FLUTTER_BIN`
  for the MCP process).
- Android Platform Tools (`adb`) when Android evidence is in scope.
- macOS with Xcode 16+, `xcrun devicectl`, signing, and a trusted Developer
  Mode device when physical iOS evidence is in scope.
- Run the installer from the toolkit checkout. The application under test may
  be the checkout itself or another Flutter project.

```powershell
node --version
flutter --version
flutter doctor -v
```

**Vietnamese:** Cần Node.js 18.18+, Flutter trên `PATH`, và ADB nếu test
Android. Test iPhone/iPad thật phải chạy MCP trên macOS có Xcode 16+, signing,
thiết bị đã trust và bật Developer Mode. Có thể test app ở cùng repo hoặc repo
khác; hãy chạy installer từ checkout của toolkit.

## 2. One-command project installation / Cài project bằng một lệnh

English:

From the toolkit root when using the Node command directly:

```powershell
node tools/install-flutter-qa-skill.mjs --scope project --agents all --configure-mcp
```

The wrappers resolve the toolkit root from their own location, so they can also
be invoked from another working directory with an absolute script path:

```powershell
.\scripts\install-skill.ps1 --scope project --agents all --configure-mcp
```

```powershell
C:\path\to\flutter-qa-sentinel\scripts\install-skill.ps1 --scope project --agents all --configure-mcp
```

```bash
bash scripts/install-skill.sh --scope project --agents all --configure-mcp
```

For an app in a different directory, provide its absolute root:

```powershell
node C:/path/to/flutter-qa-kit/tools/install-flutter-qa-skill.mjs `
  --project-root C:/path/to/my-flutter-app `
  --scope project `
  --agents all `
  --configure-mcp
```

```bash
node /path/to/flutter-qa-kit/tools/install-flutter-qa-skill.mjs \
  --project-root /path/to/my-flutter-app \
  --scope project \
  --agents all \
  --configure-mcp
```

The installer copies the canonical Skill, merges only the `flutter-qa` MCP
entry, and leaves mutation gates disabled.

**Vietnamese:** Chạy lệnh đầu tiên từ root toolkit. Nếu app ở repo khác, dùng
`--project-root` như ví dụ. Installer copy Skill, merge đúng entry MCP
`flutter-qa`, và giữ toàn bộ mutation gate ở trạng thái tắt.

## 3. Destination map / Bản đồ thư mục đích

| Host | Project scope | Global scope |
|---|---|---|
| Claude Code | `.claude/skills/flutter-qa-engineer` | `~/.claude/skills/flutter-qa-engineer` |
| Codex | `.agents/skills/flutter-qa-engineer` | `$CODEX_HOME/skills/flutter-qa-engineer` or `~/.codex/skills/flutter-qa-engineer` |
| Antigravity IDE | `.agents/skills/flutter-qa-engineer` | `~/.gemini/config/skills/flutter-qa-engineer` |
| Antigravity CLI | `.agents/skills/flutter-qa-engineer` | `~/.gemini/antigravity-cli/skills/flutter-qa-engineer` |

English: Codex and Antigravity intentionally share the project-local
`.agents/skills` copy. The canonical source remains
`.claude/skills/flutter-qa-engineer`.

**Vietnamese:** Codex và Antigravity dùng chung bản project-local trong
`.agents/skills`; source chuẩn vẫn là `.claude/skills/flutter-qa-engineer`.

## 4. Global installation and safe lifecycle / Cài global và quản lý an toàn

English:

Install global copies for reuse across workspaces:

```powershell
node tools/install-flutter-qa-skill.mjs --scope global --agents all
```

Install both project and global copies:

```powershell
node tools/install-flutter-qa-skill.mjs --scope all --agents all --configure-mcp
```

Useful read-only and lifecycle commands:

```powershell
# Verify every requested destination
node tools/install-flutter-qa-skill.mjs --verify --scope all --agents all

# Preview without writing
node tools/install-flutter-qa-skill.mjs --dry-run --scope all --agents all

# Back up and replace a divergent copy
node tools/install-flutter-qa-skill.mjs --force --scope all --agents all

# Remove only copies matching this canonical Skill
node tools/install-flutter-qa-skill.mjs --uninstall --scope all --agents all

# Print all options
node tools/install-flutter-qa-skill.mjs --help
```

The installer is idempotent. It refuses a divergent destination by default;
`--force` moves the old copy to `.skill-backups` before replacing it.

**Vietnamese:** Dùng `global` cho mọi workspace, `all` cho cả project và
global. Installer chạy lặp an toàn; bản khác sẽ không bị ghi đè nếu thiếu
`--force`, và bản cũ được backup trước khi thay thế.

## 5. MCP configuration / Cấu hình MCP

English:

`--configure-mcp` creates or merges these project-local files:

- `.mcp.json` — Claude Code auto-discovery (ignored because it has local paths);
- `.claude/mcp-config.json` — shareable Claude template;
- `.agents/mcp_config.json` — Antigravity workspace discovery.

Codex uses `config.toml`, not those JSON files. Register the server from the
Flutter project root:

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

Or add an equivalent `[mcp_servers.flutter-qa]` table to `~/.codex/config.toml`
or a trusted project-local `.codex/config.toml`. Keep user config private when
it contains machine-specific paths.

**Vietnamese:** `--configure-mcp` chỉ cấu hình Claude và Antigravity ở phạm vi
project. Codex cần đăng ký riêng bằng `codex mcp add` hoặc TOML. Sau khi cài,
ADB/iOS/remote VM Service đều vẫn bị khóa.

## 6. Build, reload, and verify / Build, reload và xác minh

English:

Build the server in the toolkit checkout before starting any agent:

```powershell
npm ci --prefix tools/flutter-mcp-server
npm run build --prefix tools/flutter-mcp-server
npm run check --prefix tools/flutter-mcp-server
```

Restart or reload each host after changing Skill or MCP configuration:

- Claude Code: run `claude mcp get flutter-qa`; approve the project server if it
  is shown as **Pending approval**, then restart the session.
- Codex: restart the app/CLI, then use `/skills` and `/mcp`.
- Antigravity: reload the workspace, then use `/skills` and `/mcp`.

Finally verify all installed copies:

```powershell
node tools/install-flutter-qa-skill.mjs --verify --scope all --agents all
```

**Vietnamese:** Build MCP trước khi mở agent. Sau khi đổi Skill/config phải
restart hoặc reload host; Claude có thể yêu cầu approve server project. Cuối
cùng chạy `--verify` để kiểm tra mọi destination.

## 7. Invoke the QA workflow / Gọi quy trình QA

English:

Use one of the activation phrases:

- `qa feature`
- `test flutter`
- `check overflow`

Or invoke the named Skill: `/flutter-qa-engineer` in Claude Code/Antigravity,
or `$flutter-qa-engineer` / `/skills` in Codex. A good first prompt is:

```text
qa feature
Read the feature spec, inspect lib/, build the happy/edge/error/validation
matrix, run the responsive overflow guard, and return an evidence report.
Do not use a real device unless I explicitly authorize it.
```

**Vietnamese:** Có thể kích hoạt bằng ba trigger hoặc gọi trực tiếp theo tên
Skill. Prompt mẫu yêu cầu agent đọc spec, lập ma trận test, kiểm tra overflow
và không đụng thiết bị thật nếu chưa được cấp quyền.

## 8. References / Tài liệu tham chiếu

- Canonical Skill: [`.claude/skills/flutter-qa-engineer/SKILL.md`](../.claude/skills/flutter-qa-engineer/SKILL.md)
- Widget template: [`.claude/skills/flutter-qa-engineer/prompts/widget_test_template.md`](../.claude/skills/flutter-qa-engineer/prompts/widget_test_template.md)
- MCP server guide: [`tools/flutter-mcp-server/README.md`](../tools/flutter-mcp-server/README.md)
- Antigravity Agent Skills: <https://antigravity.google/docs/skills/>
- Codex MCP: <https://developers.openai.com/codex/mcp>
- Claude Code MCP: <https://docs.anthropic.com/en/docs/claude-code/mcp>

**Vietnamese:** Các link trên trỏ đến Skill canonical, template widget test,
MCP README và tài liệu chính thức của ba agent.
