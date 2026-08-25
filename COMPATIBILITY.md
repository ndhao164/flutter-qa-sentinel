# Compatibility matrix

| Component | Supported baseline | Notes |
|---|---:|---|
| Node.js | 18.18+ | The MCP server uses ESM, `fetch`, and `fs.cp`. CI runs Node 20. |
| Flutter/Dart fixture | Flutter 3.29+, Dart 3.7+ | The fixture has no third-party packages. |
| MCP transport | Stdio | Claude Code, Codex CLI/IDE, and compatible MCP hosts can launch it locally. |
| Agent Skill hosts | Claude Code, Codex, Antigravity IDE/CLI | Project skills use `.claude/skills` and `.agents/skills`; the installer also supports each host's current global directory. |
| ADB | Android platform-tools on `PATH` or `ADB_BIN` | Device mutation operations are opt-in. |
| iOS device control | macOS supported by Xcode 16+ | Uses `xcrun devicectl`; physical device must be trusted and have Developer Mode enabled. Mutations are opt-in. |
| XCUITest results | Xcode 16+ modern `xcresulttool` APIs | Requires a valid workspace/project, shared scheme, signing, provisioning, and a project-local `.xcresult` bundle for the selected physical device. |
| VM Service | Local HTTP VM Service by default | Remote hosts require an environment opt-in and explicit tool argument. |

The server handles Windows `.bat`/`.cmd` executables and POSIX Flutter/ADB
commands. Run the fixture and smoke tests on the target host before enabling
device access in a CI or agent environment.

iOS device automation is macOS-only; it is not exposed through a Windows or
Linux compatibility shim. Flutter `integration_test` is preferred for
Flutter-owned UI. XCUITest is required for native platform views, system
permission dialogs, and accessibility-tree interaction outside Flutter's
widget test binding. Physical-device runs additionally depend on the app's
Apple Developer signing configuration and are not covered by the repository's
platform-neutral fixture.
