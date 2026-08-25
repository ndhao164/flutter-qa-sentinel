# Changelog

## Unreleased

- Added the spec-driven Flutter QA Sentinel Agent Skill for Claude Code and Codex.
- Added the TypeScript Flutter MCP server with Flutter CLI, analyzer, layout,
  VM Service, and allow-listed ADB tools.
- Added MCP smoke tests, skill contract validation, security gates, and GitHub
  Actions validation.
- Added a reproducible responsive Flutter fixture, parser regression tests,
  generated-output checks, package-content checks, and Dart formatting gates.
- Redacted toolchain paths, VM Service auth paths, test defines, and ADB input
  text from agent-facing command payloads; zero-test/all-skipped runs fail
  closed.
- Added macOS/iOS adapters for physical-device discovery, Flutter integration
  tests, XCUITest execution, project-local `.xcresult` inspection, and bounded
  app install/launch/terminate control through `xcrun devicectl`.
- Added a separate `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1` gate for iOS builds,
  installs, test execution, app launches, and termination; read-only discovery
  and result inspection remain available without the gate.
- Added a cross-platform, idempotent installer for project/global Claude Code,
  Codex, Antigravity IDE, and Antigravity CLI skill locations, including
  verification, dry-run, safe backup/replace, uninstall, and project MCP setup.
- Reworked the root and server documentation into English-first, bilingual
  A-to-Z setup guides with a Cockpit Tools-style language selector, a separate
  `README.vi.md` translation, external-app installation, Codex/Claude/Antigravity
  configuration, Android ADB, physical iOS/XCUITest prerequisites, and a
  public-release checklist.
