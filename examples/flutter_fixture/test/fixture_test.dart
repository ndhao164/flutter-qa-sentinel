import 'package:flutter/material.dart';
import 'package:flutter_qa_fixture/main.dart';
import 'package:flutter_test/flutter_test.dart';

typedef ResponsiveExercise = Future<void> Function(WidgetTester tester);

class QaViewport {
  const QaViewport(this.name, this.logicalSize);

  final String name;
  final Size logicalSize;
}

const _defaultViewports = <QaViewport>[
  QaViewport('small-320x568', Size(320, 568)),
  QaViewport('standard-390x844', Size(390, 844)),
  QaViewport('landscape-844x390', Size(844, 390)),
];

QaViewport? _viewportFromEnvironment() {
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

double? _textScaleFromEnvironment() {
  const raw = String.fromEnvironment('FLUTTER_TEST_TEXT_SCALE');
  return double.tryParse(raw);
}

Finder _fixtureScrollable() => find.descendant(
  of: find.byKey(const Key('fixture-scroll-view')),
  matching: find.byWidgetPredicate(
    (widget) =>
        widget is Scrollable && widget.axisDirection == AxisDirection.down,
  ),
);

Future<void> _runResponsiveCases(
  WidgetTester tester, {
  required ResponsiveExercise exercise,
}) async {
  final suppliedViewport = _viewportFromEnvironment();
  final suppliedTextScale = _textScaleFromEnvironment();
  final viewports =
      suppliedViewport == null
          ? _defaultViewports
          : <QaViewport>[suppliedViewport];
  final textScales =
      suppliedTextScale == null
          ? const <double>[1.0, 1.5]
          : <double>[suppliedTextScale];

  for (final viewport in viewports) {
    for (final textScale in textScales) {
      final view = tester.view;
      final previousPhysicalSize = view.physicalSize;
      final previousDevicePixelRatio = view.devicePixelRatio;
      final previousTextScale = tester.platformDispatcher.textScaleFactor;
      final previousErrorHandler = FlutterError.onError;
      final frameworkErrors = <FlutterErrorDetails>[];

      view.devicePixelRatio = 1.0;
      view.physicalSize = viewport.logicalSize;
      tester.platformDispatcher.textScaleFactorTestValue = textScale;
      FlutterError.onError = frameworkErrors.add;

      try {
        await tester.pumpWidget(
          MediaQuery(
            data: MediaQueryData(
              size: viewport.logicalSize,
              textScaler: TextScaler.linear(textScale),
            ),
            // Force a fresh feature state for every viewport/text-scale case;
            // otherwise pumpWidget may reuse the previous profile's form data.
            child: QaFixtureApp(key: UniqueKey()),
          ),
        );
        await tester.pump();
        // A new profile may reuse the ListView's PageStorage offset. Reset
        // the underlying Scrollable so every case starts at the same state.
        final scrollable = _fixtureScrollable();
        expect(scrollable, findsOneWidget);
        tester.state<ScrollableState>(scrollable).position.jumpTo(0);
        await tester.pump();
        await exercise(tester);
        await tester.pump();
      } finally {
        FlutterError.onError = previousErrorHandler;
        view.physicalSize = previousPhysicalSize;
        view.devicePixelRatio = previousDevicePixelRatio;
        tester.platformDispatcher.textScaleFactorTestValue = previousTextScale;
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
            '${viewport.name} textScale=$textScale reported layout overflow:\n'
            '$errorText',
      );
      expect(
        frameworkErrors,
        isEmpty,
        reason:
            '${viewport.name} textScale=$textScale reported framework error:\n'
            '$errorText',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            '${viewport.name} textScale=$textScale left an uncaught exception',
      );
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('renders and validates the feature at every QA profile', (
    tester,
  ) async {
    await _runResponsiveCases(
      tester,
      exercise: (tester) async {
        expect(find.byKey(const Key('fixture-title')), findsOneWidget);
        final scrollable = _fixtureScrollable();
        final field = find.byKey(const Key('value-field'));
        final submit = find.byKey(const Key('submit-button'));
        await tester.scrollUntilVisible(field, 160, scrollable: scrollable);
        await tester.ensureVisible(field);
        await tester.pump();
        expect(field, findsOneWidget);
        expect(submit, findsOneWidget);

        await tester.ensureVisible(submit);
        await tester.pump();
        await tester.tap(submit);
        await tester.pump();
        final errorMessage = find.text(
          'Value is required',
          skipOffstage: false,
        );
        expect(errorMessage, findsOneWidget);

        await tester.ensureVisible(field);
        await tester.pump();
        await tester.enterText(field, 'QA');
        await tester.ensureVisible(submit);
        await tester.pump();
        await tester.tap(submit);
        await tester.pumpAndSettle(const Duration(seconds: 1));
        expect(find.byKey(const Key('success-message')), findsOneWidget);
        expect(find.text('Saved: QA'), findsOneWidget);
      },
    );
  });

  testWidgets('keeps the long description available in the scroll view', (
    tester,
  ) async {
    await _runResponsiveCases(
      tester,
      exercise: (tester) async {
        expect(find.byKey(const Key('fixture-scroll-view')), findsOneWidget);
        final description = find.byKey(const Key('fixture-description'));
        final scrollable = _fixtureScrollable();
        await tester.scrollUntilVisible(
          description,
          120,
          scrollable: scrollable,
        );
        expect(description, findsOneWidget);
        final submit = find.byKey(const Key('submit-button'));
        await tester.scrollUntilVisible(submit, 160, scrollable: scrollable);
        await tester.ensureVisible(submit);
        await tester.pump();
        expect(submit, findsOneWidget);
      },
    );
  });
}
