# Contributing

Thanks for improving Flutter QA Sentinel.

## Local setup

From the repository root:

```powershell
npm ci --prefix tools/flutter-mcp-server
npm run typecheck --prefix tools/flutter-mcp-server
npm run build --prefix tools/flutter-mcp-server
npm test --prefix tools/flutter-mcp-server
npm run test:fixture --prefix tools/flutter-mcp-server
npm run prepare:codex-skill --prefix tools/flutter-mcp-server
npm run validate:skill --prefix tools/flutter-mcp-server
npm audit --prefix tools/flutter-mcp-server
```

For the Flutter fixture itself, also run:

```powershell
Push-Location examples/flutter_fixture
flutter pub get
flutter analyze
flutter test
Pop-Location
```

The repository is a toolkit, not a complete Flutter application. When testing
Flutter-specific behavior, use a disposable Flutter fixture or an existing app
and keep app-specific dependencies outside the server package.

## Change guidelines

- Keep MCP tools deterministic, bounded by time/output limits, and safe for an
  agent to call repeatedly.
- Preserve project-root and symlink-escape protections.
- Return structured JSON with actionable diagnostics; never write protocol
  messages or secrets to stdout.
- Add or update tests for parsers, validation rules, security boundaries, and
  tool behavior.
- Keep the generated `tools/flutter-mcp-server/dist/` output synchronized with
  `src/`; CI checks this invariant.
- Do not commit `.env` files, device captures, VM Service URIs, or logs that
  contain application data.

## Pull requests

Describe the behavior change, the commands run, platform coverage, and any
security or compatibility trade-offs. Changes that affect ADB or VM Service
access must include an explicit threat-model note.
