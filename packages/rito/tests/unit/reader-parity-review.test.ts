import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { PixelGoldenRun } from '../golden-pixel/helpers/pixel-cases';
import { createPixelReviewReport } from '../golden-pixel/helpers/pixel-review';
import { readerParityReviewHtml } from '../golden-pixel/helpers/reader-parity-page';
import {
  reviewReaderParityRun,
  reviewReaderParityRunError,
} from '../golden-pixel/helpers/reader-parity-review';

const RUN: PixelGoldenRun = {
  id: 'reader-parity-unit-single-default-greedy',
  bookId: 'reader-parity-unit',
  profile: {
    id: 'single-default',
    width: 2,
    height: 1,
    margin: 0,
    spread: 'single',
    spreadGap: 0,
    devicePixelRatio: 1,
    threshold: 0.08,
    maxDiffPixelRatio: 0.015,
    tags: ['unit'],
  },
  lineBreaking: 'greedy',
  tags: ['reader-parity'],
  spreadSelection: { mode: 'explicit', indexes: [0], frontmatterSpreadCount: 0 },
};

describe('reader parity review', () => {
  it('uses a strict all-pixel diff instead of the tolerant golden defaults', async () => {
    await withReport(async (report) => {
      const expected = solidPng(2, 1, 255);
      const actual = solidPng(2, 1, 255);
      const actualImage = PNG.sync.read(actual);
      actualImage.data[0] = 250;

      const records = await reviewReaderParityRun(report, RUN, {
        expected: { totalSpreads: 1, spreads: [{ spreadIndex: 0, png: expected }] },
        actual: {
          totalSpreads: 1,
          spreads: [{ spreadIndex: 0, png: PNG.sync.write(actualImage) }],
        },
        missingActualSpreadIndexes: [],
      });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        status: 'fail',
        threshold: 0,
        maxDiffPixelRatio: 0,
        diffPixels: 1,
      });
    });
  });

  it('writes explicit records for missing spreads and run-level failures', async () => {
    await withReport(async (report) => {
      const expected = solidPng(2, 1, 255);
      const missing = await reviewReaderParityRun(report, RUN, {
        expected: { totalSpreads: 1, spreads: [{ spreadIndex: 0, png: expected }] },
        actual: { totalSpreads: 1, spreads: [] },
        missingActualSpreadIndexes: [],
      });
      const failedRun = await reviewReaderParityRunError(
        report,
        RUN,
        new Error('render timed out'),
      );

      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatchObject({
        status: 'error',
        error: 'Rust production did not return spread 0',
      });
      expect(failedRun).toMatchObject({
        id: `${RUN.id}-run-error`,
        spreadIndex: -1,
        status: 'error',
        error: 'render timed out',
      });
    });
  });

  it('lazily ensures selected spreads before exact bounded completion', () => {
    const html = readerParityReviewHtml();

    expect(html).toContain("import('/reference-dist/compatibility/web.mjs')");
    expect(html).toContain("import('/dist/index.mjs')");
    expect(html).toContain('const matches = await reader.search(query)');
    expect(html).toContain('reader.findSpread(match.pageIndex)');
    expect(html).toContain('assertInitialBoundedSnapshotParity(reader, canvas');
    expect(html).toContain('ensureBoundedProductionSpread(reader, spreadIndex)');
    expect(html).toContain('ensureBoundedProductionSpread(reader, spreadIndex, deadline)');
    expect(html).toContain('if (reader.totalSpreads <= spreadIndex)');
    expect(html).toContain('if (available === false)');
    expect(html).toContain('completeBoundedProductionPagination(reader, expectedTotalSpreads)');
    expect(html).toContain('pagination.ensureSpread(expectedTotalSpreads)');
    expect(html).toContain('if (available === true)');
    expect(html).toContain('complete === true && totalSpreads === expectedTotalSpreads');
    expect(html).toContain('initial bounded snapshot differs from the TypeScript reference');
    expect(html).not.toContain('reader.onLayoutCommitted');
    const initialSnapshot = html.indexOf('await assertInitialBoundedSnapshotParity');
    const selectedSpread = html.indexOf(
      'const available = await ensureBoundedProductionSpread(reader, spreadIndex)',
    );
    const selectedRender = html.indexOf('const png = await renderStableProductionSpread');
    const exactCompletion = html.indexOf(
      'const totalSpreads = await completeBoundedProductionPagination',
    );
    expect(initialSnapshot).toBeLessThan(selectedSpread);
    expect(selectedSpread).toBeLessThan(selectedRender);
    expect(selectedRender).toBeLessThan(exactCompletion);
  });
});

async function withReport(
  run: (report: ReturnType<typeof createPixelReviewReport>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rito-reader-parity-review-'));
  const report = createPixelReviewReport({ root });
  try {
    await report.reset();
    await run(report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function solidPng(width: number, height: number, channel: number): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(channel);
  return PNG.sync.write(image);
}
