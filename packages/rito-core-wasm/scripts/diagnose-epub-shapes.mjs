import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import {
  emptySelectionMessage,
  helpText,
  loadPinnedFontManifest,
  parseOptions,
  selectEpubPaths,
} from './diagnose-epub-shapes-options.mjs';
import {
  createComparisonBookReport,
  createLegacyBookReport,
  createLegacyReport,
  createPinnedReport,
  reportHasFailures,
} from './diagnose-epub-shapes-report.mjs';

const ENTRY_PATH = resolve(import.meta.dirname, '../dist/index.mjs');
const WASM_PATH = resolve(import.meta.dirname, '../dist/rito_wasm_bg.wasm');

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  requireWasmArtifacts();
  const epubPaths = await selectEpubPaths(options);
  if (epubPaths.length === 0) throw new Error(emptySelectionMessage(options));
  const pinned = options.pinnedFontManifestPath
    ? await loadPinnedFontManifest(options.pinnedFontManifestPath)
    : undefined;
  const engine = await loadEngine();
  const report = pinned
    ? await diagnosePinnedComparison(engine, epubPaths, options, pinned)
    : await diagnoseLegacyCorpus(engine, epubPaths, options);
  await writeReport(report, options.outputPath);
  if (reportHasFailures(report)) process.exitCode = 1;
}

function requireWasmArtifacts() {
  if (!existsSync(ENTRY_PATH) || !existsSync(WASM_PATH)) {
    throw new Error('WASM dist files are missing. Run `pnpm run build:wasm` first.');
  }
}

async function loadEngine() {
  const { initRitoCoreWasmEngine } = await import(pathToFileURL(ENTRY_PATH).href);
  return await initRitoCoreWasmEngine({ module_or_path: await readFile(WASM_PATH) });
}

async function diagnoseLegacyCorpus(engine, epubPaths, options) {
  const startedAt = performance.now();
  const books = [];
  for (const [index, epubPath] of epubPaths.entries()) {
    reportProgress(index, epubPaths.length, epubPath);
    const source = await readBookSource(epubPath);
    books.push(createLegacyBookReport(source.metadata, diagnoseRun(engine, source.bytes)));
  }
  return createLegacyReport(options, books, elapsedSince(startedAt));
}

async function diagnosePinnedComparison(engine, epubPaths, options, pinned) {
  const startedAt = performance.now();
  const results = [];
  for (const [index, epubPath] of epubPaths.entries()) {
    reportProgress(index, epubPaths.length, epubPath);
    results.push(await diagnoseComparisonBook(engine, epubPath, pinned.policyInput));
  }
  return createPinnedReport(options, results, pinned.metadata, elapsedSince(startedAt));
}

function reportProgress(index, total, epubPath) {
  process.stderr.write(`[${index + 1}/${total}] ${basename(epubPath)}\n`);
}

async function diagnoseComparisonBook(engine, epubPath, policyInput) {
  const source = await readBookSource(epubPath);
  const baseline = diagnoseRun(engine, source.bytes);
  const pinned = diagnoseRun(engine, source.bytes, copyPolicyInput(policyInput));
  return createComparisonBookReport(source.metadata, baseline, pinned);
}

async function readBookSource(epubPath) {
  const bytes = await readFile(epubPath);
  return {
    bytes,
    metadata: {
      path: epubPath,
      fileName: basename(epubPath),
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function diagnoseRun(engine, bytes, pinnedFontPolicy) {
  const startedAt = performance.now();
  const openedAt = performance.now();
  let document;
  let handle;
  let acceptedSummary;
  try {
    const publicationBytes = Uint8Array.from(bytes);
    document = pinnedFontPolicy
      ? engine.openDocument(publicationBytes, { pinnedFontPolicy })
      : engine.openDocument(publicationBytes);
    const openMs = elapsedSince(openedAt);
    acceptedSummary = pinnedFontPolicy ? document.pinnedFontPolicy() : undefined;
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
    const layoutMs = elapsedSince(layoutStartedAt);
    if (revision.status !== 'complete') {
      throw new Error(`Expected complete revision, got ${revision.status}`);
    }
    const envelope = document.getShapeProvenanceDiagnosticAtRevision(handle);
    requireMatchingHandle(envelope.revision, handle);
    requireDiagnosticMatchesRevision(envelope.value, revision);
    return {
      title: publication.package?.metadata?.title,
      openMs,
      layoutMs,
      totalMs: elapsedSince(startedAt),
      pageCount: revision.pageCount,
      spreadCount: revision.spreadCount,
      diagnostic: envelope.value,
      acceptedSummary,
    };
  } catch (error) {
    return {
      totalMs: elapsedSince(startedAt),
      error: error instanceof Error ? error.message : String(error),
      acceptedSummary,
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

function copyPolicyInput(policy) {
  return {
    schemaVersion: 1,
    faces: policy.faces.map((face) => ({
      ...face,
      bytes: Uint8Array.from(face.bytes),
    })),
  };
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

async function writeReport(report, outputPath) {
  const reportText = `${JSON.stringify(report, undefined, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(reportText);
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, reportText);
  process.stderr.write(`Wrote ${outputPath}\n`);
}

function elapsedSince(startedAt) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
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

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) await main();
