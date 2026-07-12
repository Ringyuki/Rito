import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const entryPath = resolve(import.meta.dirname, '../dist/index.mjs');
const wasmPath = resolve(import.meta.dirname, '../dist/rito_wasm_bg.wasm');

if (!existsSync(entryPath) || !existsSync(wasmPath)) {
  throw new Error('WASM dist files are missing. Run `pnpm run build:wasm` first.');
}

const options = parseOptions(process.argv.slice(2));
const epubPaths = await discoverEpubs(options.directory, options.limit);
if (epubPaths.length === 0) {
  throw new Error(`No top-level EPUB files found in ${options.directory}`);
}

const { initRitoCoreWasmEngine } = await import(pathToFileURL(entryPath).href);
const engine = await initRitoCoreWasmEngine({ module_or_path: await readFile(wasmPath) });
const startedAt = performance.now();
const books = [];

for (const [index, epubPath] of epubPaths.entries()) {
  process.stderr.write(`[${index + 1}/${epubPaths.length}] ${basename(epubPath)}\n`);
  books.push(await diagnoseBook(engine, epubPath));
}

const report = {
  schemaVersion: 1,
  directory: options.directory,
  bookCount: books.length,
  uniqueContentCount: uniqueBooks(books).length,
  elapsedMs: roundMilliseconds(performance.now() - startedAt),
  summary: summarize(books),
  uniqueContentSummary: summarize(uniqueBooks(books)),
  books,
};
const reportText = `${JSON.stringify(report, undefined, 2)}\n`;

if (options.outputPath !== undefined) {
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, reportText);
  process.stderr.write(`Wrote ${options.outputPath}\n`);
} else {
  process.stdout.write(reportText);
}

if (report.summary.failedBookCount > 0) process.exitCode = 1;

async function diagnoseBook(engine, epubPath) {
  const bytes = await readFile(epubPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const openedAt = performance.now();
  let document;
  let handle;
  try {
    document = engine.openDocument(new Uint8Array(bytes));
    const openMs = roundMilliseconds(performance.now() - openedAt);
    const publication = document.publication();
    const layoutStartedAt = performance.now();
    const bundle = document.createFullRevisionBundle({
      layoutConfig: fontAwareLayoutConfig(),
      lineBreaking: 'greedy',
      activeSpreadIndex: 0,
    });
    const revision = bundle.bundle.revision;
    handle = {
      revisionId: revision.revisionId,
      revisionVersion: revision.revisionVersion,
    };
    const layoutMs = roundMilliseconds(performance.now() - layoutStartedAt);
    if (revision.status !== 'complete') {
      throw new Error(`Expected complete revision, got ${revision.status}`);
    }
    const envelope = document.getShapeProvenanceDiagnosticAtRevision(handle);
    requireMatchingHandle(envelope.revision, handle);
    requireDiagnosticMatchesRevision(envelope.value, revision);
    return {
      path: epubPath,
      fileName: basename(epubPath),
      byteLength: bytes.byteLength,
      sha256,
      title: publication.package?.metadata?.title,
      openMs,
      layoutMs,
      pageCount: revision.pageCount,
      spreadCount: revision.spreadCount,
      diagnostic: envelope.value,
    };
  } catch (error) {
    return {
      path: epubPath,
      fileName: basename(epubPath),
      byteLength: bytes.byteLength,
      sha256,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (document !== undefined) {
      try {
        if (handle !== undefined) releaseRevision(document, handle);
      } finally {
        document.free();
      }
    }
  }
}

function releaseRevision(document, handle) {
  const envelope = document.releaseRevisionAtRevision(handle);
  requireMatchingHandle(envelope.revision, handle);
  if (envelope.value?.releasedRevision !== true) {
    throw new Error(`Failed to release exact revision ${handle.revisionId}`);
  }
}

function requireMatchingHandle(actual, expected) {
  if (
    actual?.revisionId !== expected.revisionId ||
    actual?.revisionVersion !== expected.revisionVersion
  ) {
    throw new Error('Versioned shape diagnostic returned a mismatched revision handle');
  }
}

function requireDiagnosticMatchesRevision(diagnostic, revision) {
  if (diagnostic?.schemaVersion !== 1) {
    throw new Error(`Unsupported shape diagnostic schema: ${String(diagnostic?.schemaVersion)}`);
  }
  if (diagnostic.isComplete !== true) {
    throw new Error('Shape diagnostic for a complete revision reported a partial prefix');
  }
  if (diagnostic.knownPageCount !== revision.pageCount) {
    throw new Error('Shape diagnostic page count does not match its complete revision');
  }
  if (diagnostic.totalTextRuns !== diagnostic.exactTextRuns + diagnostic.unavailableTextRuns) {
    throw new Error('Shape diagnostic text-run totals are inconsistent');
  }
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
  return denominator === 0 ? 100 : roundMilliseconds((numerator / denominator) * 100);
}

async function discoverEpubs(directory, limit) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.epub'))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  return limit === undefined ? paths : paths.slice(0, limit);
}

function parseOptions(args) {
  let directory = process.env.RITO_EPUB_SMOKE_DIR ?? join(homedir(), 'Downloads');
  let outputPath;
  let limit;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--dir') directory = requireValue(args, ++index, argument);
    else if (argument === '--output') outputPath = requireValue(args, ++index, argument);
    else if (argument === '--limit')
      limit = requirePositiveInteger(requireValue(args, ++index, argument));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    directory: resolve(directory),
    ...(outputPath !== undefined ? { outputPath: resolve(outputPath) } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function requireValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function requirePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--limit must be a positive safe integer');
  }
  return parsed;
}

function roundMilliseconds(value) {
  return Math.round(value * 100) / 100;
}

function fontAwareLayoutConfig() {
  return {
    firstPageAlone: true,
    marginBottom: 24,
    marginLeft: 24,
    marginRight: 24,
    marginTop: 24,
    pageHeight: 640,
    pageWidth: 420,
    rootFontSize: 16,
    spreadGap: 0,
    spreadMode: 'single',
    textMeasurement: 'fontAware',
    viewportHeight: 640,
    viewportWidth: 420,
  };
}
