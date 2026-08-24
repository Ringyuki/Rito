export type RitoCoreWasmShapeUnavailableReason =
  | 'fixtureCompatibleMeasurement'
  | 'hostMetricsFallback'
  | 'rustybuzzUnavailable'
  | 'syntheticLayoutText'
  | 'mixedDirection'
  | 'nonClusterSafeSpacing'
  | 'nonGraphemeSafeClusters';

export type RitoCoreWasmShapeReasonCounts = Readonly<
  Partial<Record<RitoCoreWasmShapeUnavailableReason, number>>
>;

export interface RitoCoreWasmShapeAffectedCodepointFrequency {
  /** Unicode scalar formatted as uppercase `U+XXXX` (or up to six hex digits). */
  readonly codepoint: string;
  /** Scalar occurrence count across all unavailable source/base text runs. */
  readonly count: number;
  /** Breakdown of this scalar's occurrences by unavailable reason. */
  readonly reasonCounts: RitoCoreWasmShapeReasonCounts;
}

/**
 * Shape coverage for source/base text represented by Rust `LineRun::Text` in
 * the pages published by one exact revision version. Synthetic layout text can
 * also use that representation and is identified by `syntheticLayoutText`.
 * Ruby annotation text is excluded and counted separately below.
 *
 * Any result with `isComplete === false` is only a published prefix, including
 * `ready`, cancelled, and failed revisions as well as warming revisions. This
 * diagnostic traverses every published page on each call and is not cached;
 * whole-book coverage checks should request it once, final-only, after the
 * revision reaches `complete` rather than polling it during continuation.
 */
export interface RitoCoreWasmShapeProvenanceDiagnostic {
  readonly schemaVersion: 1;
  /** True only when the source revision status is `complete`. */
  readonly isComplete: boolean;
  readonly knownPageCount: number;
  /** Counts of included `LineRun::Text` runs. */
  readonly totalTextRuns: number;
  readonly exactTextRuns: number;
  readonly unavailableTextRuns: number;
  /** UTF-16 code units in included run text, not Unicode scalar counts. */
  readonly totalTextUtf16CodeUnitCount: number;
  readonly exactTextUtf16CodeUnitCount: number;
  readonly unavailableTextUtf16CodeUnitCount: number;
  /** Ruby annotation runs and UTF-16 units omitted from all coverage counts. */
  readonly excludedRubyTextRunCount: number;
  readonly excludedRubyTextUtf16CodeUnitCount: number;
  readonly singleFontTextRuns: number;
  readonly mixedFontTextRuns: number;
  /** Unavailable run counts grouped by reason. */
  readonly unavailableReasonCounts: RitoCoreWasmShapeReasonCounts;
  /** Unavailable UTF-16 code-unit counts grouped by reason. */
  readonly unavailableReasonUtf16CodeUnitCounts: RitoCoreWasmShapeReasonCounts;
  /**
   * Exact single-font run counts keyed by a 16-lowercase-hex, 64-bit diagnostic
   * font ID. The truncated ID is for diagnostics, not collision-free identity.
   */
  readonly singleFontFingerprints: Readonly<Record<string, number>>;
  /**
   * Number of exact mixed-font runs containing each 64-bit diagnostic font ID.
   * One mixed run contributes at most once to a given ID.
   */
  readonly mixedFontFingerprints: Readonly<Record<string, number>>;
  /**
   * Global Top 256 across all unavailable reasons, ordered by count descending
   * then scalar ascending. This is not a per-reason Top-N, and the scalars are
   * all text in unavailable runs—not claims that their glyphs are missing.
   */
  readonly unavailableAffectedCodepoints: readonly RitoCoreWasmShapeAffectedCodepointFrequency[];
  /** Unicode scalar occurrences across all unavailable runs, including omitted Top-N entries. */
  readonly unavailableAffectedCodepointOccurrenceCount: number;
  /** Unique Unicode scalars across all unavailable runs. */
  readonly unavailableAffectedCodepointDistinctCount: number;
  /** `max(distinctCount - 256, 0)`; returned entries are `min(distinctCount, 256)`. */
  readonly unavailableAffectedCodepointOmittedCount: number;
}
