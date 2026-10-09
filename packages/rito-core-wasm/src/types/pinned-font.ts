export type RitoCoreWasmPinnedFontGenericRole = 'serif' | 'sansSerif' | 'monospace';

/** A host face added to an open session, its bytes handed over. */
export interface RitoCoreWasmHostFontFaceInput {
  readonly bytes: ArrayBuffer;
  readonly expectedSha256: string;
  readonly genericRole: RitoCoreWasmPinnedFontGenericRole;
  readonly language?: string | undefined;
}

/** One face of a nameable family. */
export interface RitoCoreWasmFontFamilyFace {
  readonly weight: number;
  readonly style: string;
  /** A host face's SHA-256, the handle it is removed by; null for a publication face. */
  readonly sha256: string | null;
}

/** A family a `font-family` list can name. */
export interface RitoCoreWasmFontFamily {
  readonly name: string;
  readonly source: 'host' | 'publication';
  /** The generic family a host family serves; null for a publication's. */
  readonly genericRole: RitoCoreWasmPinnedFontGenericRole | null;
  /** A host family's language (`und` serves every language); null for a publication's. */
  readonly language: string | null;
  readonly faces: readonly RitoCoreWasmFontFamilyFace[];
}

/** Every family a `font-family` list can name in an open session. */
export interface RitoCoreWasmFontCatalog {
  readonly families: readonly RitoCoreWasmFontFamily[];
}
