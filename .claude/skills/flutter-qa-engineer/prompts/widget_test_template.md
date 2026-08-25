# Flutter widget-test template

Use this template when a feature needs deterministic widget coverage. Keep the
viewport harness in a shared test utility (for example,
`test/support/responsive_test.dart`) once more than one feature uses it. The
only project-specific parts are the subject widget, its public dependency
interfaces, and the injection scope used by the app. Do not bypass that scope
with production-only globals.

## 1. Dependencies and imports

Use the versions already pinned by the project. The test needs `flutter_test`
and exactly one mocking style (Mocktail or Mockito); `provider`,
`flutter_riverpod`, `flutter_bloc`, and `bloc_test` are included only when the
feature uses those scopes.

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

// Add only the state-management imports used by the subject:
// import 'package:provider/provider.dart';
// import 'package:flutter_riverpod/flutter_riverpod.dart';
// import 'package:flutter_bloc/flutter_bloc.dart';
// import 'package:bloc_test/bloc_test.dart';

// Import the production subject and its public contracts here.
// import 'package:app/features/example/presentation/example_page.dart';
// import 'package:app/features/example/domain/example_repository.dart';
```

## 2. Reusable viewport and framework-error harness

This helper uses the current `WidgetTester.view` API. On an older Flutter
channel, keep the same contract but implement `setViewport` with
`tester.binding.window` and restore the old values in `finally`.

```dart
typedef ResponsiveExercise = Future<void> Function(WidgetTester tester);

class QaViewport {
  const QaViewport(this.name, this.logicalSize);

  final String name;
  final Size logicalSize;
}

const qaViewports = <QaViewport>[
  QaViewport('small-320x568', Size(320, 568)),
  QaViewport('standard-390x844', Size(390, 844)),
  QaViewport('landscape-844x390', Size(844, 390)),
];

QaViewport? qaViewportFromEnvironment() {
  const widthRaw = String.fromEnvironment('FLUTTER_TEST_WIDTH');
  const heightRaw = String.fromEnvironment('FLUTTER_TEST_HEIGHT');
  const name = String.fromEnvironment(
    'FLUTTER_TEST_BREAKPOINT',
    defaultValue: 'mcp-profile',
  );
  final width = double.tryParse(widthRaw);
  final height = double.tryParse(heightRaw);
  if (width == null || height == null) return null;
  return QaViewport(name, Size(width, height));
}

double? qaTextScaleFromEnvironment() {
  const raw = String.fromEnvironment('FLUTTER_TEST_TEXT_SCALE');
  return double.tryParse(raw);
}

int qaExpectedProfileCount() =>
    qaViewportFromEnvironment() == null ? qaViewports.length * 2 : 1;

/// Pumps [child] at one logical viewport and text scale, then fails on
/// RenderFlex/layout errors. The view and Flutter error handler are restored
/// even when the exercise throws.
Future<void> runResponsiveCase(
  WidgetTester tester, {
  required QaViewport viewport,
  required double textScale,
  required Widget child,
  required ResponsiveExercise exercise,
}) async {
  final view = tester.view;
  final previousPhysicalSize = view.physicalSize;
  final previousDevicePixelRatio = view.devicePixelRatio;
  final previousTextScaleFactor = tester.platformDispatcher.textScaleFactor;
  final previousErrorHandler = FlutterError.onError;
  final frameworkErrors = <FlutterErrorDetails>[];

  view.devicePixelRatio = 1.0;
  view.physicalSize = viewport.logicalSize;
  // This reaches widgets below MaterialApp/WidgetsApp, which create their own
  // MediaQuery from the platform dispatcher.
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  FlutterError.onError = frameworkErrors.add;

  try {
    await tester.pumpWidget(
      MediaQuery(
        data: MediaQueryData(
          size: viewport.logicalSize,
          textScaler: TextScaler.linear(textScale),
        ),
        child: child,
      ),
    );
    await tester.pump();
    await exercise(tester);
    await tester.pump();
  } finally {
    FlutterError.onError = previousErrorHandler;
    // A direct restore avoids leaking one profile into the next profile. If
    // the channel does not expose setters, use resetPhysicalSize() and
    // resetDevicePixelRatio() instead.
    view.physicalSize = previousPhysicalSize;
    view.devicePixelRatio = previousDevicePixelRatio;
    tester.platformDispatcher.textScaleFactorTestValue =
        previousTextScaleFactor;
  }

  final errorText = frameworkErrors
      .map((details) => details.exceptionAsString())
      .join('\n');
  final overflow = RegExp(
    r'(RenderFlex overflowed|A RenderFlex overflowed|overflowed by)',
    caseSensitive: false,
  ).hasMatch(errorText);

  expect(
    overflow,
    isFalse,
    reason:
        '${viewport.name} textScale=$textScale reported a layout overflow:\n$errorText',
  );
  expect(
    frameworkErrors,
    isEmpty,
    reason:
        '${viewport.name} textScale=$textScale reported an unexpected Flutter framework error:\n$errorText',
  );

  final uncaught = tester.takeException();
  expect(
    uncaught,
    isNull,
    reason:
        '${viewport.name} textScale=$textScale left an uncaught widget-test exception',
  );
}

Future<void> runAllResponsiveCases(
  WidgetTester tester, {
  required Widget Function() buildSubject,
  required ResponsiveExercise exercise,
}) async {
  // A normal `flutter test` invocation runs the full in-process matrix. The
  // MCP overflow tool starts one process per profile and supplies dart-defines;
  // in that mode run exactly the supplied profile to avoid a 6x6 duplicate.
  final externalViewport = qaViewportFromEnvironment();
  final externalTextScale = qaTextScaleFromEnvironment();
  final viewports = externalViewport == null
      ? qaViewports
      : <QaViewport>[externalViewport];
  final textScales = externalTextScale == null
      ? const <double>[1.0, 1.5]
      : <double>[externalTextScale];

  for (final viewport in viewports) {
    for (final textScale in textScales) {
      await runResponsiveCase(
        tester,
        viewport: viewport,
        textScale: textScale,
        child: buildSubject(),
        exercise: exercise,
      );
    }
  }
}
```

`frameworkErrors` intentionally remains visible to the assertion instead of
being swallowed by a custom `FlutterError.onError`. A test that needs to assert
an expected framework exception should scope that assertion narrowly and still
fail on any overflow message.

## 3. Mocktail injection (no generated file)

Mock the repository/use-case interface at the boundary. Register every custom
fallback once in `setUpAll`; never let a mock call a real API.

```dart
abstract interface class ExampleRepository {
  Future<String> loadTitle();
  Future<void> submit(String value);
}

class MockExampleRepository extends Mock implements ExampleRepository {}

class FakeSubmitRequest extends Fake {
  const FakeSubmitRequest(this.value);

  final String value;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockExampleRepository repository;

  setUpAll(() {
    registerFallbackValue(const FakeSubmitRequest('fallback'));
  });

  setUp(() {
    repository = MockExampleRepository();
  });

  testWidgets('renders the successful state at every required profile',
      (tester) async {
    when(() => repository.loadTitle()).thenAnswer((_) async => 'Ready');

    await runAllResponsiveCases(
      tester,
      buildSubject: () => buildSubjectWithProvider(repository),
      exercise: (tester) async {
        await tester.pumpAndSettle(const Duration(seconds: 2));
        expect(find.text('Ready'), findsOneWidget);
      },
    );
    verify(() => repository.loadTitle()).called(qaExpectedProfileCount());
  });
}

Widget buildSubjectWithProvider(ExampleRepository repository) {
  // Replace this function with the app's real composition root. Keep the
  // production widget unchanged and inject only its public dependency.
  return ExamplePage(repository: repository);
}
```

For an argument matcher, use a registered fallback and verify the observable
request rather than a private implementation detail:

```dart
when(() => repository.submit(any())).thenAnswer((_) async {});
await tester.tap(find.byKey(const Key('submit-button')));
await tester.pumpAndSettle();
verify(() => repository.submit(any())).called(1);
```

## 4. Mockito injection (generated mocks)

Use this variant when the repository already uses Mockito. Keep generated files
under the project’s normal build-runner output policy.

```dart
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';

import 'example_widget_test.mocks.dart';

@GenerateMocks(<Type>[ExampleRepository])
void main() {
  late MockExampleRepository repository;

  setUp(() {
    repository = MockExampleRepository();
  });

  testWidgets('shows an API error and retry action', (tester) async {
    when(repository.loadTitle()).thenThrow(const TimeoutException('offline'));

    await runAllResponsiveCases(
      tester,
      buildSubject: () => buildSubjectWithProvider(repository),
      exercise: (tester) async {
        await tester.pumpAndSettle(const Duration(seconds: 2));
        expect(find.byKey(const Key('error-message')), findsOneWidget);
        expect(find.byKey(const Key('retry-button')), findsOneWidget);
      },
    );
  });
}
```

Run the repository’s documented `build_runner` command to generate
`example_widget_test.mocks.dart`; do not commit a hand-written approximation
of generated Mockito code.

## 5. Provider, Riverpod, and Bloc scopes

Use exactly one adapter that matches the production composition root. The
following snippets show the shape; retain the app’s actual provider symbol and
state types.

### Provider

```dart
Widget buildSubjectWithProvider(ExampleRepository repository) {
  return MultiProvider(
    providers: <SingleChildWidget>[
      Provider<ExampleRepository>.value(value: repository),
    ],
    child: const ExamplePage(),
  );
}
```

If the app uses a `ChangeNotifier`, construct a test notifier with injected
fakes and dispose it in `addTearDown`; do not share mutable notifier state
between viewport profiles.

### Riverpod

```dart
Widget buildSubjectWithRiverpod(ExampleRepository repository) {
  return ProviderScope(
    overrides: <Override>[
      exampleRepositoryProvider.overrideWithValue(repository),
    ],
    child: const ExamplePage(),
  );
}
```

When a test creates a `ProviderContainer` directly, call `container.dispose()`
in `addTearDown` and use `container.listen`/`container.read` only for state
assertions that are not visible through the widget.

### Bloc/Cubit

```dart
Widget buildSubjectWithBloc(ExampleCubit cubit) {
  return BlocProvider<ExampleCubit>.value(
    value: cubit,
    child: const ExamplePage(),
  );
}

// With bloc_test, stub state/stream transitions and close an owned bloc:
// whenListen(cubit, Stream<ExampleState>.fromIterable(states),
//     initialState: states.first);
// addTearDown(cubit.close);
```

Prefer `BlocProvider.value` for a mock/previously-created cubit and
`BlocProvider(create: ...)` for a widget-owned real cubit. A test must not close
a cubit that the production widget owns unless the test created that cubit.

## 6. Full feature-test skeleton

The following skeleton demonstrates the required matrix and the four behavior
families. Replace only the named public subject/contracts and labels from the
spec; keep the harness and failure assertions intact.

```dart
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late MockExampleRepository repository;

  setUp(() {
    repository = MockExampleRepository();
  });

  testWidgets('happy path and form validation are responsive', (tester) async {
    when(() => repository.loadTitle()).thenAnswer((_) async => 'Ready');

    await runAllResponsiveCases(
      tester,
      buildSubject: () => buildSubjectWithProvider(repository),
      exercise: (tester) async {
        await tester.pumpAndSettle(const Duration(seconds: 2));
        expect(find.byKey(const Key('feature-content')), findsOneWidget);

        // Form validation: submit empty input and assert the accessible error.
        await tester.tap(find.byKey(const Key('submit-button')));
        await tester.pump();
        expect(find.bySemanticsLabel('Value is required'), findsOneWidget);
      },
    );
  });

  testWidgets('network failure exposes recovery', (tester) async {
    when(() => repository.loadTitle())
        .thenThrow(const TimeoutException('request timed out'));

    await runAllResponsiveCases(
      tester,
      buildSubject: () => buildSubjectWithProvider(repository),
      exercise: (tester) async {
        await tester.pumpAndSettle(const Duration(seconds: 2));
        expect(find.byKey(const Key('error-message')), findsOneWidget);
        expect(find.byKey(const Key('retry-button')), findsOneWidget);
      },
    );
  });
}
```

Before merging, run the focused file and then the full suite with the same
Flutter channel used by CI. Keep the first overflow stack-trace line in the
failure report so the self-healing loop can distinguish a production layout
bug from an invalid test fixture.
