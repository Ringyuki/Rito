export interface ProductionPinnedFontExpectation {
  readonly sha256: string;
  readonly byteLength: number;
  readonly genericRole: string;
  readonly language: string;
}

export const PRODUCTION_PINNED_FONT_EXPECTATIONS = [
  {
    sha256: '60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61',
    byteLength: 521_588,
    genericRole: 'serif',
    language: 'und',
  },
  {
    sha256: '3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d',
    byteLength: 11_626_108,
    genericRole: 'serif',
    language: 'zh-hans',
  },
] as const satisfies readonly ProductionPinnedFontExpectation[];

export function requireProductionPinnedFontExpectations(
  actual: readonly ProductionPinnedFontExpectation[],
): void {
  const matches =
    actual.length === PRODUCTION_PINNED_FONT_EXPECTATIONS.length &&
    PRODUCTION_PINNED_FONT_EXPECTATIONS.every((expected, index) => {
      const candidate = actual[index];
      return (
        candidate?.sha256 === expected.sha256 &&
        candidate.byteLength === expected.byteLength &&
        candidate.genericRole === expected.genericRole &&
        candidate.language === expected.language
      );
    });
  if (!matches) {
    throw new Error('Reader usability gate pinned-font policy does not match production E2E');
  }
}

export const PRODUCTION_PINNED_FONT_HASHES = PRODUCTION_PINNED_FONT_EXPECTATIONS.map(
  (font) => font.sha256,
);
export const PRODUCTION_PINNED_FONT_BYTE_LENGTHS = PRODUCTION_PINNED_FONT_EXPECTATIONS.map(
  (font) => font.byteLength,
);
export const PRODUCTION_PINNED_FONT_ALIASES = PRODUCTION_PINNED_FONT_HASHES.map(
  (hash) => `__RitoPinned_${hash}`,
);
export const PRODUCTION_PINNED_FONT_SELECTORS = PRODUCTION_PINNED_FONT_EXPECTATIONS.map(
  ({ genericRole, language }) => ({ genericRole, language }),
);
