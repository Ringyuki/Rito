export function createLegacyBookReport(metadata, run) {
  if (run.error !== undefined) return { ...metadata, error: run.error };
  const legacy = { ...run };
  delete legacy.acceptedSummary;
  delete legacy.totalMs;
  return { ...metadata, ...legacy };
}

export function createComparisonBookReport(metadata, baseline, pinned) {
  const title = baseline.title ?? pinned.title;
  return {
    acceptedSummary: pinned.acceptedSummary,
    book: {
      ...metadata,
      ...(title !== undefined ? { title } : {}),
      baseline: publicRun(baseline),
      pinned: publicRun(pinned),
      delta: comparisonDelta(baseline, pinned),
    },
  };
}

export function createLegacyReport(options, books, elapsedMs) {
  return {
    schemaVersion: 1,
    directory: reportDirectory(options),
    bookCount: books.length,
    uniqueContentCount: uniqueBooks(books).length,
    elapsedMs,
    summary: summarize(books),
    uniqueContentSummary: summarize(uniqueBooks(books)),
    books,
  };
}

export function createPinnedReport(options, results, pinnedMetadata, elapsedMs) {
  const books = results.map((result) => result.book);
  return {
    schemaVersion: 1,
    directory: reportDirectory(options),
    bookCount: books.length,
    uniqueContentCount: uniqueBooks(books).length,
    elapsedMs,
    pinnedFontPolicy: {
      ...pinnedMetadata,
      acceptedSummary: consistentAcceptedPolicy(results),
    },
    baseline: summarizeProfile(books, 'baseline'),
    pinned: summarizeProfile(books, 'pinned'),
    delta: summarizeComparisonDelta(books),
    books,
  };
}

export function reportHasFailures(report) {
  if (report.pinnedFontPolicy === undefined) return report.summary.failedBookCount > 0;
  return report.baseline.coverage.failedBookCount > 0 || report.pinned.coverage.failedBookCount > 0;
}

function reportDirectory(options) {
  return options.files.length === 0 ? options.directory : null;
}

function publicRun(run) {
  const result = { ...run };
  delete result.acceptedSummary;
  delete result.title;
  return result;
}

function consistentAcceptedPolicy(results) {
  let accepted;
  for (const result of results) {
    if (result.acceptedSummary === undefined) continue;
    if (accepted === undefined) accepted = result.acceptedSummary;
    else if (JSON.stringify(result.acceptedSummary) !== JSON.stringify(accepted)) {
      throw new Error('Pinned font policy identity changed between EPUB runs');
    }
  }
  return accepted ?? null;
}

function summarizeProfile(books, key) {
  const runs = books.map((book) => ({ ...book[key], sha256: book.sha256 }));
  const uniqueRuns = uniqueBooks(runs);
  return {
    coverage: summarize(runs),
    uniqueContentCoverage: summarize(uniqueRuns),
    timing: summarizeTiming(runs),
    uniqueContentTiming: summarizeTiming(uniqueRuns),
  };
}

function summarizeTiming(runs) {
  const successful = runs.filter((run) => run.diagnostic !== undefined);
  return {
    successfulBookCount: successful.length,
    openMs: roundTwo(sum(successful, (run) => run.openMs)),
    layoutMs: roundTwo(sum(successful, (run) => run.layoutMs)),
    totalMs: roundTwo(sum(successful, (run) => run.totalMs)),
  };
}

function summarizeComparisonDelta(books) {
  const comparable = books.filter(
    (book) => book.baseline.diagnostic !== undefined && book.pinned.diagnostic !== undefined,
  );
  const baseline = comparable.map((book) => book.baseline);
  const pinned = comparable.map((book) => book.pinned);
  return {
    comparableBookCount: comparable.length,
    coverage: coverageDelta(summarize(baseline), summarize(pinned)),
    timing: timingDelta(summarizeTiming(baseline), summarizeTiming(pinned)),
  };
}

function comparisonDelta(baseline, pinned) {
  if (baseline.diagnostic === undefined || pinned.diagnostic === undefined) return null;
  return {
    coverage: coverageDelta(
      summarize([{ diagnostic: baseline.diagnostic, pageCount: baseline.pageCount }]),
      summarize([{ diagnostic: pinned.diagnostic, pageCount: pinned.pageCount }]),
    ),
    timing: timingDelta(summarizeTiming([baseline]), summarizeTiming([pinned])),
    pageCount: pinned.pageCount - baseline.pageCount,
    spreadCount: pinned.spreadCount - baseline.spreadCount,
  };
}

function coverageDelta(baseline, pinned) {
  return {
    exactTextRuns: pinned.exactTextRuns - baseline.exactTextRuns,
    unavailableTextRuns: pinned.unavailableTextRuns - baseline.unavailableTextRuns,
    exactTextRunPercentagePoints: roundTwo(
      pinned.exactTextRunPercent - baseline.exactTextRunPercent,
    ),
    exactTextUtf16CodeUnitCount:
      pinned.exactTextUtf16CodeUnitCount - baseline.exactTextUtf16CodeUnitCount,
    unavailableTextUtf16CodeUnitCount:
      pinned.unavailableTextUtf16CodeUnitCount - baseline.unavailableTextUtf16CodeUnitCount,
    exactTextUtf16CodeUnitPercentagePoints: roundTwo(
      pinned.exactTextUtf16CodeUnitPercent - baseline.exactTextUtf16CodeUnitPercent,
    ),
  };
}

function timingDelta(baseline, pinned) {
  return {
    openMs: roundTwo(pinned.openMs - baseline.openMs),
    layoutMs: roundTwo(pinned.layoutMs - baseline.layoutMs),
    totalMs: roundTwo(pinned.totalMs - baseline.totalMs),
  };
}

function summarize(books) {
  const successful = books.filter((book) => book.diagnostic !== undefined);
  const totalTextRuns = sum(successful, (book) => book.diagnostic.totalTextRuns);
  const exactTextRuns = sum(successful, (book) => book.diagnostic.exactTextRuns);
  const totalTextUtf16CodeUnitCount = sum(
    successful,
    (book) => book.diagnostic.totalTextUtf16CodeUnitCount,
  );
  const exactTextUtf16CodeUnitCount = sum(
    successful,
    (book) => book.diagnostic.exactTextUtf16CodeUnitCount,
  );
  return {
    successfulBookCount: successful.length,
    failedBookCount: books.length - successful.length,
    pageCount: sum(successful, (book) => book.pageCount),
    totalTextRuns,
    exactTextRuns,
    unavailableTextRuns: sum(successful, (book) => book.diagnostic.unavailableTextRuns),
    exactTextRunPercent: percentage(exactTextRuns, totalTextRuns),
    totalTextUtf16CodeUnitCount,
    exactTextUtf16CodeUnitCount,
    unavailableTextUtf16CodeUnitCount: sum(
      successful,
      (book) => book.diagnostic.unavailableTextUtf16CodeUnitCount,
    ),
    exactTextUtf16CodeUnitPercent: percentage(
      exactTextUtf16CodeUnitCount,
      totalTextUtf16CodeUnitCount,
    ),
    excludedRubyTextRunCount: sum(successful, (book) => book.diagnostic.excludedRubyTextRunCount),
    excludedRubyTextUtf16CodeUnitCount: sum(
      successful,
      (book) => book.diagnostic.excludedRubyTextUtf16CodeUnitCount,
    ),
    unavailableReasonCounts: mergeCounts(
      successful.map((book) => book.diagnostic.unavailableReasonCounts),
    ),
    unavailableReasonUtf16CodeUnitCounts: mergeCounts(
      successful.map((book) => book.diagnostic.unavailableReasonUtf16CodeUnitCounts),
    ),
  };
}

function uniqueBooks(books) {
  return [...new Map(books.map((book) => [book.sha256, book])).values()];
}

function sum(values, select) {
  return values.reduce((total, value) => total + select(value), 0);
}

function mergeCounts(groups) {
  const merged = {};
  for (const group of groups) {
    for (const [key, count] of Object.entries(group)) merged[key] = (merged[key] ?? 0) + count;
  }
  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function percentage(numerator, denominator) {
  return denominator === 0 ? 100 : roundTwo((numerator / denominator) * 100);
}

function roundTwo(value) {
  return Math.round(value * 100) / 100;
}
