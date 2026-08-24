import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { loadPinnedFontManifest, parseOptions } from '../scripts/diagnose-epub-shapes-options.mjs';
import {
  createComparisonBookReport,
  createLegacyBookReport,
  createLegacyReport,
  createPinnedReport,
} from '../scripts/diagnose-epub-shapes-report.mjs';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = resolve(import.meta.dirname, '../scripts/diagnose-epub-shapes.mjs');

test('shape diagnostic options accept repeatable files and a pinned manifest', () => {
  const options = parseOptions(
    [
      '--file',
      'first.epub',
      '--file',
      'second.EPUB',
      '--pinned-font',
      'fonts/policy.json',
      '--output',
      'report.json',
    ],
    {},
  );

  assert.deepEqual(options.files, [resolve('first.epub'), resolve('second.EPUB')]);
  assert.equal(options.pinnedFontManifestPath, resolve('fonts/policy.json'));
  assert.equal(options.outputPath, resolve('report.json'));
  assert.equal(options.limit, undefined);
});

test('shape diagnostic options reject ambiguous or duplicate selections', () => {
  const invalid = [
    ['--file', 'book.epub', '--dir', 'books'],
    ['--file', 'book.epub', '--limit', '1'],
    ['--file', 'book.epub', '--file', 'book.epub'],
    ['--pinned-font', 'one.json', '--pinned-font', 'two.json'],
    ['--help', '--output', 'report.json'],
  ];

  for (const args of invalid) assert.throws(() => parseOptions(args, {}));
});

test('pinned font manifest resolves relative files, verifies hashes, and normalizes metadata', async (t) => {
  const root = await temporaryDirectory(t);
  const font = Buffer.from('static-font-fixture');
  const hash = sha256(font);
  await writeFile(join(root, 'fallback.ttf'), font);
  const manifestPath = join(root, 'policy.json');
  await writeJson(manifestPath, {
    schemaVersion: 1,
    faces: [
      {
        path: 'fallback.ttf',
        expectedSha256: hash.toUpperCase(),
        genericRole: 'serif',
        language: 'ZH-Hant',
      },
    ],
  });

  const pinned = await loadPinnedFontManifest(manifestPath);

  assert.equal(pinned.metadata.manifestPath, manifestPath);
  assert.equal(pinned.metadata.fontByteLength, font.byteLength);
  assert.deepEqual(pinned.metadata.faces, [
    {
      path: join(root, 'fallback.ttf'),
      expectedSha256: hash,
      genericRole: 'serif',
      language: 'zh-hant',
      byteLength: font.byteLength,
    },
  ]);
  assert.deepEqual(pinned.policyInput.faces[0], {
    bytes: Uint8Array.from(font),
    expectedSha256: hash,
    genericRole: 'serif',
    language: 'zh-hant',
  });
});

test('pinned font manifest rejects unknown fields, bad hashes, and duplicate selectors', async (t) => {
  const root = await temporaryDirectory(t);
  const first = Buffer.from('first-static-font');
  const second = Buffer.from('second-static-font');
  await writeFile(join(root, 'first.ttf'), first);
  await writeFile(join(root, 'second.otf'), second);
  const manifestPath = join(root, 'policy.json');
  const face = {
    path: 'first.ttf',
    expectedSha256: sha256(first),
    genericRole: 'serif',
  };
  const invalid = [
    { schemaVersion: 1, faces: [face], extra: true },
    { schemaVersion: 2, faces: [face] },
    { schemaVersion: 1, faces: [{ ...face, expectedSha256: '0'.repeat(64) }] },
    {
      schemaVersion: 1,
      faces: [
        face,
        {
          path: 'second.otf',
          expectedSha256: sha256(second),
          genericRole: 'serif',
        },
      ],
    },
    { schemaVersion: 1, faces: [{ ...face, language: 'zh--Hant' }] },
  ];

  for (const manifest of invalid) {
    await writeJson(manifestPath, manifest);
    await assert.rejects(loadPinnedFontManifest(manifestPath));
  }
});

test('legacy reports retain the pre-comparison output shape', () => {
  const metadata = bookMetadata();
  const run = shapeRun({ exactTextRuns: 0, unavailableTextRuns: 2 });
  const book = createLegacyBookReport(metadata, run);
  const report = createLegacyReport({ directory: '/books', files: [] }, [book], 12.5);

  assert.equal(Object.hasOwn(book, 'totalMs'), false);
  assert.equal(Object.hasOwn(book, 'acceptedSummary'), false);
  assert.equal(book.title, 'Fixture');
  assert.equal(report.directory, '/books');
  assert.equal(report.summary.exactTextRuns, 0);
  assert.equal(report.summary.unavailableTextRuns, 2);
  assert.equal(Object.hasOwn(report, 'pinnedFontPolicy'), false);
});

test('pinned reports expose both profiles, accepted policy metadata, and deltas', () => {
  const baseline = shapeRun({
    exactTextRuns: 0,
    unavailableTextRuns: 2,
    openMs: 1,
    layoutMs: 4,
  });
  const acceptedSummary = { schemaVersion: 1, policyId: 'a'.repeat(64), faces: [] };
  const pinned = {
    ...shapeRun({
      exactTextRuns: 2,
      unavailableTextRuns: 0,
      openMs: 2,
      layoutMs: 3,
    }),
    acceptedSummary,
  };
  const result = createComparisonBookReport(bookMetadata(), baseline, pinned);
  const metadata = {
    schemaVersion: 1,
    manifestPath: '/policy.json',
    fontByteLength: 42,
    faces: [],
  };
  const report = createPinnedReport(
    { directory: '/books', files: ['/books/fixture.epub'] },
    [result],
    metadata,
    9,
  );

  assert.equal(report.directory, null);
  assert.deepEqual(report.pinnedFontPolicy, { ...metadata, acceptedSummary });
  assert.equal(report.baseline.coverage.exactTextRuns, 0);
  assert.equal(report.pinned.coverage.exactTextRuns, 2);
  assert.equal(report.baseline.timing.totalMs, 5);
  assert.equal(report.pinned.timing.totalMs, 5);
  assert.equal(report.delta.coverage.exactTextRuns, 2);
  assert.equal(report.books[0].delta.coverage.exactTextRunPercentagePoints, 100);
});

test('shape diagnostic help does not require a built WASM artifact', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT_PATH, '--help']);

  assert.match(stdout, /--file <epub>/);
  assert.match(stdout, /--pinned-font <manifest>/);
  assert.equal(stderr, '');
});

async function temporaryDirectory(t) {
  const path = await mkdtemp(join(tmpdir(), 'rito-shape-runner-'));
  t.after(async () => await rm(path, { recursive: true, force: true }));
  return path;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bookMetadata() {
  return {
    path: '/books/fixture.epub',
    fileName: 'fixture.epub',
    byteLength: 12,
    sha256: 'b'.repeat(64),
  };
}

function shapeRun({ exactTextRuns, unavailableTextRuns, openMs = 1, layoutMs = 4 }) {
  const totalTextRuns = exactTextRuns + unavailableTextRuns;
  return {
    title: 'Fixture',
    openMs,
    layoutMs,
    totalMs: openMs + layoutMs,
    pageCount: 1,
    spreadCount: 1,
    diagnostic: {
      totalTextRuns,
      exactTextRuns,
      unavailableTextRuns,
      totalTextUtf16CodeUnitCount: totalTextRuns,
      exactTextUtf16CodeUnitCount: exactTextRuns,
      unavailableTextUtf16CodeUnitCount: unavailableTextRuns,
      excludedRubyTextRunCount: 0,
      excludedRubyTextUtf16CodeUnitCount: 0,
      unavailableReasonCounts:
        unavailableTextRuns === 0 ? {} : { missingPinnedFont: unavailableTextRuns },
      unavailableReasonUtf16CodeUnitCounts:
        unavailableTextRuns === 0 ? {} : { missingPinnedFont: unavailableTextRuns },
    },
  };
}
