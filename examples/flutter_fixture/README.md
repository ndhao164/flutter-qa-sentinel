# Flutter QA fixture

This is a deliberately small Flutter application used to validate the
`flutter-qa-engineer` skill and the repository's Flutter MCP server. It has no
third-party dependencies, network calls, generated code, or device setup. The
screen includes:

- a responsive summary area;
- a required-value form validation state; and
- a deterministic success state.

The widget test runs each behavior through the required responsive matrix:
`320x568`, `390x844`, and `844x390`, at text scales `1.0` and `1.5`. The test
also understands the MCP server's `FLUTTER_TEST_*` Dart defines, so the MCP
server can run one profile per process.

## Run locally

From this directory:

```powershell
flutter pub get
flutter analyze
flutter test
```

Run one MCP-compatible profile manually:

```powershell
flutter test test/fixture_test.dart `
  --dart-define=FLUTTER_TEST_WIDTH=320 `
  --dart-define=FLUTTER_TEST_HEIGHT=568 `
  --dart-define=FLUTTER_TEST_TEXT_SCALE=1.5 `
  --dart-define=FLUTTER_TEST_BREAKPOINT=small
```

From the repository root, the MCP calls can target this fixture by setting
`cwd` to `examples/flutter_fixture` and `testPath` to `test/fixture_test.dart`.
For example, call `check_layout_overflow` in `both` mode with the default
breakpoints and text scales, then call `run_flutter_tests` for the same test.
