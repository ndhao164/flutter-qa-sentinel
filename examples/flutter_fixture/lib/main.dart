import 'package:flutter/material.dart';

void main() {
  runApp(const QaFixtureApp());
}

/// Small, self-contained app used by the repository's Flutter QA examples.
///
/// The page deliberately has a form, a success state, and a responsive summary
/// area so the generated QA workflow can exercise happy-path, validation, and
/// large-text/landscape scenarios without a network or third-party package.
class QaFixtureApp extends StatelessWidget {
  const QaFixtureApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Flutter QA Fixture',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      home: const QaFixtureHomePage(),
    );
  }
}

class QaFixtureHomePage extends StatefulWidget {
  const QaFixtureHomePage({super.key});

  @override
  State<QaFixtureHomePage> createState() => _QaFixtureHomePageState();
}

class _QaFixtureHomePageState extends State<QaFixtureHomePage> {
  final _formKey = GlobalKey<FormState>();
  final _valueController = TextEditingController();
  String? _errorMessage;
  String? _successMessage;
  bool _isSubmitting = false;

  @override
  void dispose() {
    _valueController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final value = _valueController.text.trim();
    if (value.isEmpty) {
      setState(() {
        _errorMessage = 'Value is required';
        _successMessage = null;
      });
      return;
    }

    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
      _successMessage = null;
    });

    // A short deterministic delay represents an injected repository call.
    // Keeping it local makes this fixture safe to run offline and in CI.
    await Future<void>.delayed(const Duration(milliseconds: 20));
    if (!mounted) return;

    setState(() {
      _isSubmitting = false;
      _successMessage = 'Saved: $value';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Flutter QA Fixture')),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final horizontalPadding = constraints.maxWidth < 360 ? 16.0 : 24.0;

            return ListView(
              key: const Key('fixture-scroll-view'),
              padding: EdgeInsets.fromLTRB(
                horizontalPadding,
                24,
                horizontalPadding,
                32,
              ),
              children: <Widget>[
                Text(
                  'Responsive QA playground',
                  key: const Key('fixture-title'),
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                const Text(
                  'A tiny feature with deterministic states for unit and widget '
                  'tests. Try a narrow viewport or larger text to exercise the '
                  'overflow guard.',
                  key: const Key('fixture-description'),
                ),
                const SizedBox(height: 20),
                _SummarySection(
                  key: const Key('fixture-summary'),
                  isCompact: constraints.maxWidth < 600,
                ),
                const SizedBox(height: 20),
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      TextFormField(
                        key: const Key('value-field'),
                        controller: _valueController,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: const InputDecoration(
                          labelText: 'Value',
                          hintText: 'Enter a value',
                          border: const OutlineInputBorder(),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Value is required';
                          }
                          return null;
                        },
                      ),
                      if (_errorMessage != null) ...<Widget>[
                        const SizedBox(height: 8),
                        Semantics(
                          liveRegion: true,
                          label: _errorMessage,
                          child: Text(
                            _errorMessage!,
                            key: const Key('error-message'),
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        key: const Key('submit-button'),
                        onPressed: _isSubmitting ? null : _submit,
                        icon:
                            _isSubmitting
                                ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                                : const Icon(Icons.check),
                        label: Text(_isSubmitting ? 'Saving…' : 'Save value'),
                      ),
                      if (_successMessage != null) ...<Widget>[
                        const SizedBox(height: 12),
                        Semantics(
                          liveRegion: true,
                          label: _successMessage,
                          child: Container(
                            key: const Key('success-message'),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color:
                                  Theme.of(
                                    context,
                                  ).colorScheme.primaryContainer,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(_successMessage!),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _SummarySection extends StatelessWidget {
  const _SummarySection({required this.isCompact, super.key});

  final bool isCompact;

  @override
  Widget build(BuildContext context) {
    final cards = <Widget>[
      const _SummaryCard(
        title: 'Happy path',
        detail: 'Submit a value and observe a success state.',
        icon: Icons.check_circle_outline,
      ),
      const _SummaryCard(
        title: 'Validation',
        detail: 'Submit an empty value to see accessible feedback.',
        icon: Icons.rule,
      ),
    ];

    if (isCompact) {
      return Column(children: cards);
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(child: cards[0]),
        const SizedBox(width: 12),
        Expanded(child: cards[1]),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.title,
    required this.detail,
    required this.icon,
  });

  final String title;
  final String detail;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, semanticLabel: title),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(detail),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
