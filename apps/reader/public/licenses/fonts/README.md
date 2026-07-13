# Bundled reader fallback fonts

The Reader app redistributes these unmodified font binaries so the Rust shaper
and browser Canvas use identical fallback metrics.

## Tinos Regular

- file: `Tinos-Regular.ttf`
- upstream: <https://github.com/googlefonts/tinos>
- source commit: `3b4482a99b80ea5fc75f187b1be3120a3f5905b3`
- SHA-256: `60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61`
- license: [SIL Open Font License 1.1](./tinos/OFL.txt)

## Source Han Serif CN Regular

- file: `SourceHanSerifCN-Regular.otf`
- upstream: <https://github.com/adobe-fonts/source-han-serif>
- release: `2.003R`, asset `14_SourceHanSerifCN.zip`
- SHA-256: `3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d`
- license: [SIL Open Font License 1.1](./source-han-serif/OFL.txt)

The files are not modified. The application registers them under generated
runtime aliases derived from their complete SHA-256 digests.
