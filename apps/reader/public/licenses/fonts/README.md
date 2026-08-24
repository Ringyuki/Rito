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

## Arimo Regular

- file: `Arimo-Regular.ttf`
- upstream: <https://github.com/googlefonts/Arimo>
- source: `fonts/ttf/Arimo-Regular.ttf` on `main` (fetched 2026-08-24)
- SHA-256: `41b22bc8f0b51f932825d37bc55b5eb6ba67dfe599a626e4aff2b43b624f9f8c`
- license: [SIL Open Font License 1.1](./arimo/OFL.txt)

## Source Han Sans CN Regular

- file: `SourceHanSansCN-Regular.otf`
- upstream: <https://github.com/adobe-fonts/source-han-sans>
- release: `2.004R`, asset `SourceHanSansCN.zip` (SubsetOTF/CN)
- SHA-256: `c0aa89a70f92a820ff95490fea6d472cd19621a71c9a748a4950eb2eafe6438e`
- license: [SIL Open Font License 1.1](./source-han-sans/LICENSE.txt)

The files are not modified. The application registers them under generated
runtime aliases derived from their complete SHA-256 digests.
