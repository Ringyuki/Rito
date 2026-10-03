export type RitoCoreWasmPinnedFontGenericRole = 'serif' | 'sansSerif' | 'monospace';

/** One immutable fallback face supplied while a native document opens. */
export interface RitoCoreWasmPinnedFontFaceInput {
  readonly bytes: Uint8Array;
  readonly expectedSha256: string;
  readonly genericRole: RitoCoreWasmPinnedFontGenericRole;
  readonly language?: string | undefined;
}

/** Versioned, document-lifetime fallback policy consumed by the Rust engine. */
export interface RitoCoreWasmPinnedFontPolicyInput {
  readonly schemaVersion: 1;
  readonly faces: readonly RitoCoreWasmPinnedFontFaceInput[];
}

export interface RitoCoreWasmOpenDocumentOptions {
  readonly pinnedFontPolicy?: RitoCoreWasmPinnedFontPolicyInput | undefined;
}

/** Bytes-free metadata for one host face accepted by Rust. */
export interface RitoCoreWasmPinnedFontFaceSummary {
  readonly sha256: string;
  /** The family a `font-family` list names the face by (its name table's). */
  readonly familyName: string;
  readonly shapeFingerprint: string;
  /** The family name paint draws the face by; register its bytes under it. */
  readonly familyAlias: string;
  readonly byteLength: number;
  readonly genericRole: RitoCoreWasmPinnedFontGenericRole;
  readonly language: string;
  /** The face's own slope and weight. */
  readonly style: 'normal' | 'italic';
  readonly weight: number;
}

/** Rust-authored identity for the accepted document-lifetime fallback policy. */
export interface RitoCoreWasmPinnedFontPolicySummary {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly faces: readonly RitoCoreWasmPinnedFontFaceSummary[];
}

/** A host face added to an open document, its bytes handed over. */
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

/** Every family a `font-family` list can name in an open document. */
export interface RitoCoreWasmFontCatalog {
  readonly families: readonly RitoCoreWasmFontFamily[];
}
