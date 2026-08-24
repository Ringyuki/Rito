# Codicon Test Font Notice

The Base64 test font in `production-canvas-parity.test.ts` is a modified subset
of the Codicon icon font from the
[`microsoft/vscode-codicons`](https://github.com/microsoft/vscode-codicons)
project.

- Creator: Microsoft Corporation and vscode-codicons contributors
- Source: `codicon.ttf`, as bundled with Playwright 1.59.1
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- Modification: subset with HarfBuzz to retain only the U+EA60 glyph; the test
  assigns a local font-family name at runtime

The subset is used only as deterministic font data for browser/Rust pixel
parity testing. No endorsement by Microsoft or the vscode-codicons contributors
is implied.
