## Summary

<!-- Describe the behavior or documentation change and the motivation. -->

## Validation

- [ ] `npm run check --prefix tools/flutter-mcp-server`
- [ ] `npm run test:fixture --prefix tools/flutter-mcp-server` (when Flutter is available)
- [ ] `flutter analyze` / `flutter test` for any affected app or fixture
- [ ] Generated `tools/flutter-mcp-server/dist/` output is synchronized

## Safety and compatibility

- [ ] No secrets, VM Service URIs, device captures, or personal logs are included
- [ ] ADB/VM Service security boundaries are preserved (or the threat-model change is explained below)
- [ ] Changes remain compatible with the versions in `COMPATIBILITY.md`

## Notes for reviewers

<!-- Include failure classification, migration notes, or known limitations. -->
