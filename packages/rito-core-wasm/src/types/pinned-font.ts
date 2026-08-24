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

/** Canonical bytes-free metadata for one face accepted by Rust. */
export interface RitoCoreWasmPinnedFontFaceSummary {
  readonly sha256: string;
  readonly shapeFingerprint: string;
  readonly familyAlias: string;
  readonly byteLength: number;
  readonly genericRole: RitoCoreWasmPinnedFontGenericRole;
  readonly language: string;
  readonly style: 'normal';
  readonly weight: 400;
}

/** Rust-authored identity for the accepted document-lifetime fallback policy. */
export interface RitoCoreWasmPinnedFontPolicySummary {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly faces: readonly RitoCoreWasmPinnedFontFaceSummary[];
}
