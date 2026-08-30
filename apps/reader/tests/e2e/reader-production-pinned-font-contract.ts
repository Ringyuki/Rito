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

/**
 * The full policy a reader session OPENS with: the usability-gate serif
 * pair above plus the sans pair the font-family override menu serves.
 * The engine sorts faces by (generic role, language, hash).
 */
export const PRODUCTION_PINNED_OPEN_EXPECTATIONS = [
  ...PRODUCTION_PINNED_FONT_EXPECTATIONS,
  {
    sha256: '41b22bc8f0b51f932825d37bc55b5eb6ba67dfe599a626e4aff2b43b624f9f8c',
    byteLength: 478_712,
    genericRole: 'sansSerif',
    language: 'und',
  },
  {
    sha256: 'c0aa89a70f92a820ff95490fea6d472cd19621a71c9a748a4950eb2eafe6438e',
    byteLength: 8_331_636,
    genericRole: 'sansSerif',
    language: 'zh-hans',
  },
] as const satisfies readonly ProductionPinnedFontExpectation[];

export const PRODUCTION_PINNED_FONT_HASHES = PRODUCTION_PINNED_OPEN_EXPECTATIONS.map(
  (font) => font.sha256,
);
export const PRODUCTION_PINNED_FONT_BYTE_LENGTHS = PRODUCTION_PINNED_OPEN_EXPECTATIONS.map(
  (font) => font.byteLength,
);
export const PRODUCTION_PINNED_FONT_ALIASES = PRODUCTION_PINNED_FONT_HASHES.map(
  (hash) => `__RitoPinned_${hash}`,
);
export const PRODUCTION_PINNED_FONT_SELECTORS = PRODUCTION_PINNED_OPEN_EXPECTATIONS.map(
  ({ genericRole, language }) => ({ genericRole, language }),
);
