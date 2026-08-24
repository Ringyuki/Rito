import { requireObjectInput } from './core-wasm-versioned-validation-runtime.js';

const MAX_AFFECTED_CODEPOINTS = 256;
const UNAVAILABLE_REASONS = new Set([
  'fixtureCompatibleMeasurement',
  'hostMetricsFallback',
  'rustybuzzUnavailable',
  'syntheticLayoutText',
  'mixedDirection',
  'nonClusterSafeSpacing',
  'nonGraphemeSafeClusters',
]);
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const CODEPOINT_RE = /^U\+[0-9A-F]{4,6}$/;

export function requireShapeProvenanceDiagnostic(value, _revision, operation) {
  const diagnostic = requireObjectInput(value, `${operation} diagnostic`);
  if (diagnostic.schemaVersion !== 1) {
    throw new Error(`${operation} returned an unsupported shape diagnostic schemaVersion`);
  }
  if (typeof diagnostic.isComplete !== 'boolean') {
    throw new Error(`${operation} returned an invalid shape diagnostic isComplete`);
  }
  const counts = countFields(diagnostic, operation);
  if (counts.totalTextRuns !== counts.exactTextRuns + counts.unavailableTextRuns) {
    throw new Error(`${operation} returned inconsistent exact/unavailable run counts`);
  }
  if (counts.exactTextRuns !== counts.singleFontTextRuns + counts.mixedFontTextRuns) {
    throw new Error(`${operation} returned inconsistent single/mixed font run counts`);
  }
  if (
    counts.totalTextUtf16CodeUnitCount !==
    counts.exactTextUtf16CodeUnitCount + counts.unavailableTextUtf16CodeUnitCount
  ) {
    throw new Error(`${operation} returned inconsistent exact/unavailable UTF-16 counts`);
  }
  requireZeroUnitsWithoutRuns(counts, operation);

  const reasons = frequencyMap(
    diagnostic.unavailableReasonCounts,
    operation,
    'unavailableReasonCounts',
    (key) => UNAVAILABLE_REASONS.has(key),
  );
  if (sum(reasons) !== counts.unavailableTextRuns) {
    throw new Error(`${operation} returned inconsistent unavailable reason counts`);
  }
  const reasonUtf16Counts = frequencyMap(
    diagnostic.unavailableReasonUtf16CodeUnitCounts,
    operation,
    'unavailableReasonUtf16CodeUnitCounts',
    (key) => UNAVAILABLE_REASONS.has(key),
  );
  if (sum(reasonUtf16Counts) !== counts.unavailableTextUtf16CodeUnitCount) {
    throw new Error(`${operation} returned inconsistent unavailable reason UTF-16 counts`);
  }
  if (Object.keys(reasonUtf16Counts).some((reason) => reasons[reason] === undefined)) {
    throw new Error(`${operation} returned UTF-16 units for an absent unavailable reason`);
  }
  const single = frequencyMap(
    diagnostic.singleFontFingerprints,
    operation,
    'singleFontFingerprints',
    (key) => FINGERPRINT_RE.test(key),
  );
  const mixed = frequencyMap(
    diagnostic.mixedFontFingerprints,
    operation,
    'mixedFontFingerprints',
    (key) => FINGERPRINT_RE.test(key),
  );
  if (sum(single) !== counts.singleFontTextRuns) {
    throw new Error(`${operation} returned inconsistent single-font fingerprint counts`);
  }
  if (
    (counts.mixedFontTextRuns === 0 && sum(mixed) !== 0) ||
    (counts.mixedFontTextRuns > 0 && sum(mixed) < counts.mixedFontTextRuns * 2) ||
    Object.values(mixed).some((count) => count > counts.mixedFontTextRuns)
  ) {
    throw new Error(`${operation} returned inconsistent mixed-font fingerprint counts`);
  }

  requireAffectedCodepoints(diagnostic, counts, reasons, operation);
  return diagnostic;
}

function countFields(diagnostic, operation) {
  const names = [
    'knownPageCount',
    'totalTextRuns',
    'exactTextRuns',
    'unavailableTextRuns',
    'totalTextUtf16CodeUnitCount',
    'exactTextUtf16CodeUnitCount',
    'unavailableTextUtf16CodeUnitCount',
    'excludedRubyTextRunCount',
    'excludedRubyTextUtf16CodeUnitCount',
    'singleFontTextRuns',
    'mixedFontTextRuns',
    'unavailableAffectedCodepointOccurrenceCount',
    'unavailableAffectedCodepointDistinctCount',
    'unavailableAffectedCodepointOmittedCount',
  ];
  return Object.fromEntries(
    names.map((name) => [name, safeCount(diagnostic[name], operation, name)]),
  );
}

function requireAffectedCodepoints(diagnostic, counts, unavailableReasons, operation) {
  const entries = diagnostic.unavailableAffectedCodepoints;
  if (!Array.isArray(entries) || entries.length > MAX_AFFECTED_CODEPOINTS) {
    throw new Error(`${operation} returned invalid unavailableAffectedCodepoints`);
  }
  const occurrenceCount = counts.unavailableAffectedCodepointOccurrenceCount;
  const distinctCount = counts.unavailableAffectedCodepointDistinctCount;
  if (
    counts.unavailableTextRuns === 0 &&
    (entries.length !== 0 ||
      occurrenceCount !== 0 ||
      distinctCount !== 0 ||
      counts.unavailableAffectedCodepointOmittedCount !== 0)
  ) {
    throw new Error(`${operation} returned affected codepoints without unavailable text runs`);
  }
  const expectedReturned = Math.min(distinctCount, MAX_AFFECTED_CODEPOINTS);
  const expectedOmitted = Math.max(distinctCount - MAX_AFFECTED_CODEPOINTS, 0);
  if (
    entries.length !== expectedReturned ||
    counts.unavailableAffectedCodepointOmittedCount !== expectedOmitted
  ) {
    throw new Error(`${operation} returned inconsistent affected codepoint truncation counts`);
  }
  if (distinctCount > occurrenceCount) {
    throw new Error(`${operation} returned more distinct than occurring affected codepoints`);
  }
  if (occurrenceCount > counts.unavailableTextUtf16CodeUnitCount) {
    throw new Error(`${operation} returned too many affected codepoint occurrences`);
  }
  let returnedOccurrences = 0;
  let previous;
  const seen = new Set();
  for (const value of entries) {
    const entry = requireObjectInput(value, `${operation} affected codepoint`);
    const codepoint = scalarValue(entry.codepoint, operation);
    const count = safePositiveCount(entry.count, operation, 'affected codepoint count');
    if (seen.has(codepoint)) throw new Error(`${operation} returned a duplicate codepoint`);
    seen.add(codepoint);
    const reasonCounts = frequencyMap(
      entry.reasonCounts,
      operation,
      'affected codepoint reasonCounts',
      (key) => UNAVAILABLE_REASONS.has(key),
    );
    if (sum(reasonCounts) !== count) {
      throw new Error(`${operation} returned inconsistent affected codepoint reason counts`);
    }
    if (Object.keys(reasonCounts).some((reason) => unavailableReasons[reason] === undefined)) {
      throw new Error(`${operation} returned an affected codepoint for an absent reason`);
    }
    if (
      previous &&
      (count > previous.count || (count === previous.count && codepoint < previous.codepoint))
    ) {
      throw new Error(`${operation} returned unsorted affected codepoints`);
    }
    previous = { codepoint, count };
    returnedOccurrences += count;
  }
  const total = occurrenceCount;
  if (
    returnedOccurrences > total ||
    (counts.unavailableAffectedCodepointOmittedCount === 0 && returnedOccurrences !== total)
  ) {
    throw new Error(`${operation} returned inconsistent affected codepoint occurrence counts`);
  }
}

function requireZeroUnitsWithoutRuns(counts, operation) {
  if (
    (counts.totalTextRuns === 0 && counts.totalTextUtf16CodeUnitCount !== 0) ||
    (counts.exactTextRuns === 0 && counts.exactTextUtf16CodeUnitCount !== 0) ||
    (counts.unavailableTextRuns === 0 && counts.unavailableTextUtf16CodeUnitCount !== 0) ||
    (counts.excludedRubyTextRunCount === 0 && counts.excludedRubyTextUtf16CodeUnitCount !== 0)
  ) {
    throw new Error(`${operation} returned UTF-16 units without corresponding text runs`);
  }
}

function frequencyMap(value, operation, field, validKey) {
  const map = requireObjectInput(value, `${operation} ${field}`);
  for (const [key, count] of Object.entries(map)) {
    if (!validKey(key)) throw new Error(`${operation} returned an invalid ${field} key`);
    safePositiveCount(count, operation, field);
  }
  return map;
}

function scalarValue(value, operation) {
  if (typeof value !== 'string' || !CODEPOINT_RE.test(value)) {
    throw new Error(`${operation} returned an invalid affected codepoint`);
  }
  const scalar = Number.parseInt(value.slice(2), 16);
  if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) {
    throw new Error(`${operation} returned a non-scalar affected codepoint`);
  }
  return scalar;
}

function safeCount(value, operation, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} returned an invalid ${field}`);
  }
  return value;
}

function safePositiveCount(value, operation, field) {
  const count = safeCount(value, operation, field);
  if (count === 0) throw new Error(`${operation} returned a zero ${field}`);
  return count;
}

function sum(map) {
  return Object.values(map).reduce((total, count) => total + count, 0);
}
