---
name: flutter-qa-engineer
description: "Run a spec-driven Flutter QA workflow: inspect lib/, plan acceptance tests, generate unit and widget tests, verify responsive layouts and text scaling, exercise authorized Android/iOS device flows when required, and iterate on actionable failures. Activate for 'qa feature', 'test flutter', or 'check overflow' requests."
metadata:
  short-description: Spec-driven Flutter QA automation
  triggers:
    - qa feature
    - test flutter
    - check overflow
---

# Flutter QA Engineer

## Mission and activation

Use this skill when a Flutter feature has been implemented from a specification, design document, issue, or other project documentation and it needs an evidence-based QA pass. The expected outcome is a traceable test matrix, maintainable tests under `test/`, a clean analyzer result for touched code, a responsive/overflow check that is green at every required breakpoint, and device-run evidence when a physical Android/iOS flow is part of the requested scope.

This skill is host-neutral. Claude Code discovers it from
`.claude/skills/flutter-qa-engineer/SKILL.md`; Codex discovers the mirrored
project copy from `.agents/skills/flutter-qa-engineer`; Antigravity discovers
the same project-local path. The repository may keep that mirror as a copy or a
symlink depending on checkout support. The trigger phrases in the metadata are
intent hints for automatic selection; the explicit commands are
`/flutter-qa-engineer` in Claude Code and Antigravity, and
`$flutter-qa-engineer` (or `/skills`) in Codex. After adding or updating a
skill, restart the agent or reload its workspace skill index.

For repeatable installation across all three hosts, run
`node tools/install-flutter-qa-skill.mjs --scope all --agents all` from this
repository. The installer preserves an existing destination unless `--force`
is supplied, verifies the copied `SKILL.md`, and can configure the project MCP
file with `--configure-mcp`.

Do not treat a green command as proof that the feature is correct: assertions must be derived from the spec and the test run must cover the documented behavior. Do not remove assertions, mark tests `skip`/`todo`, or hide Flutter errors merely to obtain a green build.

## Operating contract

- Work from the repository root and inspect the existing `pubspec.yaml`, `analysis_options.yaml`, test conventions, generated-code policy, and dependency-injection style before writing tests.
- Preserve unrelated user changes. Keep production changes in `lib/` narrowly scoped to a demonstrated defect, and mirror the project’s existing Clean Architecture boundaries.
- Prefer the project’s configured Flutter MCP tools (`run_flutter_tests`, `analyze_code`, `check_layout_overflow`, Android `run_adb_command`, and the iOS device/XCTest tools) when available. Fall back to the local Flutter/Dart/Xcode CLI when the MCP server is not configured, and record the exact command and exit code.
- For a physical iOS target, call `list_ios_devices` before selecting a device. Use `run_ios_integration_tests` for Flutter-owned UI and `run_xcuitests` when native views, permission dialogs, system UI, or accessibility-tree interaction is part of the acceptance criterion. Use read-only `inspect_xcresult` to diagnose an existing result bundle. Do not use `ios_app_control` or run a device test unless the user has authorized device mutation and `FLUTTER_MCP_ALLOW_IOS_MUTATIONS=1` is set.
- Treat signing, provisioning, Trust/Developer Mode, device availability, and Xcode version failures as environment/tooling failures. Do not change bundle identifiers, teams, certificates, entitlements, or provisioning settings merely to make a test run.
- Never use a real network, clock, filesystem, or device in a unit/widget test unless the spec explicitly requires an integration test. Inject repositories, clients, clocks, and feature flags at the boundary.
- Use the project’s already-pinned versions of Mockito, Mocktail, Provider, Riverpod, and Bloc. Add a dev dependency only when the project’s dependency policy permits it; otherwise use a small hand-written fake and report the missing package.
- Keep test names behavior-oriented (`given_when_then` or the repository’s established convention), deterministic, and independent of implementation details such as private methods.

The reusable widget-test harness and injection examples are in [prompts/widget_test_template.md](prompts/widget_test_template.md). Read that file when generating or repairing a widget test.

## SOP: five required steps

### 1. Ingestion — establish the feature contract

1. Locate the authoritative spec/doc (issue, README, `docs/`, design notes, or the user-provided text). Extract explicit acceptance criteria, non-functional constraints, copy, navigation outcomes, and error behavior. If two sources disagree, record the conflict and use the most authoritative source rather than silently guessing.
2. Inspect the feature’s `lib/` slice and its imports. Identify:
   - Widgets and routes, including loading/empty/error/success states;
   - `State`/controllers/cubits/notifiers and their transitions;
   - domain use cases and entities;
   - repositories, API clients, serializers, persistence, and retry behavior;
   - localization, theming, accessibility semantics, and feature flags.
3. Inspect existing tests and test utilities to learn how Provider/Riverpod/Bloc scopes, generated mocks, fake data, navigation, and golden conventions are set up. Search for TODOs, `debugPrint`, unhandled futures, and existing overflow failures related to the feature.
4. Build a short requirement-to-code map before editing: criterion → source symbol → observable assertion → test layer. Keep assumptions explicit so a later failure can be classified as a spec ambiguity rather than “fixed” by weakening a test.

### 2. Matrix Planning — turn criteria into executable cases

Create a test-case matrix before implementing tests. At minimum it must contain all four required categories:

| Category | Required evidence |
| --- | --- |
| Happy path | Valid input, successful repository/API response, expected state, content, and navigation |
| Edge cases | Empty/minimal/maximal values, repeated actions, cancellation, pagination/boundaries, and offline/cache behavior where applicable |
| Network/API error | Timeout, non-2xx/domain failure, malformed payload, retry, and user-visible recovery |
| Form validations | Required fields, format/range rules, focus/keyboard behavior, submit enabled/disabled state, and accessible error text |

For every applicable criterion choose the smallest adequate layer:

- Unit tests for pure domain rules, mappers, validators, and state transitions.
- Widget tests for composition, injected dependencies, rendering, semantics, gestures, form behavior, and navigation contracts.
- Integration/e2e tests only for platform channels, real routing integration, permissions, or behavior that cannot be isolated. Keep these separate from the fast unit/widget suite. On iOS, route Flutter-owned flows to `integration_test` and native/system-owned UI to XCUITest; assign stable Keys/semantics/accessibility identifiers at the app boundary instead of coordinate-based taps.

Every widget case must be tagged in the matrix with the viewport/text-scale combinations from step 4. Include loading, empty, error, and success states even when the happy path is the only state shown in a design mock.

### 3. Test Suite Generation — implement maintainable tests

1. Create tests in a path that mirrors `lib/` (for example `test/features/<feature>/..._test.dart`). Keep fixtures close to the feature and reuse existing builders/fakes rather than duplicating large JSON blobs.
2. For unit tests, mock/fake repository interfaces at the domain boundary and assert outputs/state transitions, not HTTP implementation details. Verify both success and failure mapping, including cancellation and retry semantics when specified.
3. For widget tests, build the smallest realistic dependency graph. Inject one deterministic repository response per test and mount the same top-level scopes the app uses. Use the template’s Mocktail, Mockito, Provider, Riverpod, or Bloc adapter as appropriate:
   - Mocktail: call `registerFallbackValue` once for every custom argument matcher type, then stub with `when(...).thenAnswer(...)`.
   - Mockito: use `@GenerateMocks` and the project’s `build_runner` flow; never hand-edit generated files.
   - Provider: override with `Provider.value`/`ChangeNotifierProvider` in a test-only `MultiProvider`.
   - Riverpod: use `ProviderScope(overrides: [...])` and dispose containers after each test.
   - Bloc/Cubit: use `BlocProvider.value` for an owned test bloc or `BlocProvider(create: ...)` when the widget owns its lifecycle; close owned blocs in teardown.
4. Prefer semantic finders (`find.byKey`, `find.text`, `find.bySemanticsLabel`) and user-visible behavior over private widget types. Use `pump` for a known frame, `pumpAndSettle` with a bounded timeout for animations, and explicitly flush fake async work. Avoid arbitrary sleeps.
5. Capture Flutter framework errors during each widget case (see the template). A `RenderFlex overflowed`, `overflowed by`, or equivalent layout assertion is a test failure, even if the target widget still renders.
6. Keep assertions specific: exact domain values and required labels, minimum tap targets/semantics when specified, and route arguments. Avoid snapshotting incidental tree structure.
7. When iOS device evidence is required, keep the Flutter test under `integration_test/` or the native test in the project's existing XCUITest target. Select the physical device by its normalized identifier from `list_ios_devices`; never guess a device or silently fall back to another connected phone. Store `.xcresult`, screenshots, and attachments only in the project's ignored artifact directory.

### 4. Responsive & Overflow Guard — mandatory viewport matrix

The responsive guard is required for **every Widget test**, including tests that appear unrelated to layout. Run the test body at all applicable combinations below, and always include the `TextScale 1.5x` variant:

| Profile | Logical size | Text scale |
| --- | --- | --- |
| Small screen | `320x568` | `1.0` and `1.5` |
| Standard | `390x844` | `1.0` and `1.5` |
| Landscape | `844x390` (also `568x320` when the feature has a compact landscape layout) | `1.0` and `1.5` |

Use `WidgetTester.view` on current Flutter (`physicalSize` plus `devicePixelRatio = 1.0`) and restore it in `addTearDown`; use the project’s compatibility helper for older Flutter channels. Wrap the subject in `MediaQuery` with `TextScaler.linear(1.5)` (or the channel-compatible equivalent). When the subject contains `MaterialApp`/`WidgetsApp`, also set `tester.platformDispatcher.textScaleFactorTestValue` so its internally-created `MediaQuery` receives the scale, then restore the previous value in `finally`. Rebuild after changing the view so layout is recalculated.

For each combination:

1. Install a temporary `FlutterError.onError` collector and restore the previous handler in a `finally` block.
2. Pump the widget through its initial and settled states, exercise the interaction under test, and inspect the collector and test output for `RenderFlex overflowed`, `A RenderFlex overflowed`, `overflowed by`, clipped text, and failed layout assertions.
3. Fail with the profile name, logical size, text scale, and the first relevant stack-trace line. A screenshot or semantics dump is useful diagnostic evidence, but it does not replace the assertion.

Do not “solve” an overflow by reducing text scale, clipping required content, hiding the error handler, or changing a requirement without documenting the spec decision. Fix layout constraints in `lib/` (for example flexible children, scrolling, safe insets, or adaptive spacing) or fix an incorrect test fixture only after classification in step 5.

### 5. Self-healing loop — classify, repair, and prove

Run the focused test first, then the full affected suite, analyzer, and the complete viewport matrix after each repair. Parse the command/MCP result into a failure record containing command, profile, test name, exception, stack trace, and overflow line when present.

When the plan includes a physical iOS pass, run it only after the fast suite and
responsive matrix are green. Verify the selected device is available, execute
the focused Flutter integration test or XCUITest, then inspect the returned or
existing `.xcresult` bundle for failed tests, diagnostics, screenshots, and
attachments. An app launch or an empty Xcode result is not evidence of a
passing flow. Do not retry an install, launch, termination, or device test more
than once without first classifying the prior failure.

Classify each failure before editing:

1. **Feature/spec defect:** implementation or `lib/` behavior contradicts an explicit criterion, or a real runtime/layout error is reproduced by a minimal test. Apply the smallest Clean Architecture fix, preserve public contracts, and add/adjust a regression test.
2. **Test defect:** finder targets an incidental detail, a mock is unstubbed/wrongly scoped, an async pump races, or the fixture violates the documented contract. Repair the test/harness and keep the behavior assertion.
3. **Environment/tooling defect:** missing SDK/dependency, unavailable emulator, generated-code failure, or a platform-only limitation. Repair local test setup when safe; otherwise report the blocker with evidence. Never convert it to a passing skip.

Use a bounded hypothesis loop (one focused repair and one verification run per hypothesis; normally no more than three hypotheses per failure). If it still fails, stop changing code, report the exact blocker and next diagnostic, and ask for the missing external input. A self-healing pass is complete only when **100% of planned tests pass**, no required test is skipped, the analyzer has no errors (and no new warnings in touched code), every required viewport/text-scale profile is free of overflow errors, and every in-scope physical-device flow has a non-empty passing integration/XCTest result.

## Completion report

Return a concise evidence report with:

- spec/acceptance criteria covered and any explicit assumptions;
- tests added or changed, grouped by unit/widget/integration and matrix profiles;
- commands or MCP tools run, pass/fail counts, duration, and exit codes;
- physical device name/identifier (redacted when externally shared), platform,
  iOS/Xcode versions, integration/XCUITest target, `.xcresult` summary, and
  artifact locations when an iOS device pass was required;
- analyzer diagnostics and any remaining pre-existing warnings;
- repairs made in `lib/` versus repairs made in tests, with the failure classification;
- unresolved blockers (if any) and the exact command/log needed to continue.

Do not claim completion until the completion gate in step 5 is satisfied.
