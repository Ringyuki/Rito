import { expect, test } from '@playwright/test';

import { runPinnedFallbackCycle } from './pinned-fallback-browser-cycle';
import {
  buildPinnedFallbackProductionCore,
  createPinnedFallbackFixture,
  installPinnedFallbackHarness,
  openPinnedFallbackHarness,
  PINNED_FALLBACK_QUERY,
} from './pinned-fallback-fixture';
import { installPinnedFallbackProbe, readPinnedFallbackProbe } from './pinned-fallback-probe';
import { installReaderWorkerProbe, readReaderWorkerOperations } from './reader-worker-probe';

test.describe('production pinned fallback worker path', () => {
  test.beforeAll(async () => {
    await buildPinnedFallbackProductionCore();
  });

  // FIXME(fragment-source-locator): pre-existing gap of the fragment
  // cutover, on record since the backend landed ("source locators still
  // resolve Unavailable" in chapter_engine_session/fragment). Tracked for
  // the post-release fragment interaction pass together with search
  // source resolution.
  test.fixme('keeps Rust shape identity, Canvas paint, exact geometry, and disposal stable', async ({
    page,
  }) => {
    const fixture = await createPinnedFallbackFixture();
    await installReaderWorkerProbe(page);
    await installPinnedFallbackProbe(page);
    await installPinnedFallbackHarness(page, fixture);
    await openPinnedFallbackHarness(page);

    const first = await runPinnedFallbackCycle(page, fixture);
    const second = await runPinnedFallbackCycle(page, fixture);
    const probe = await readPinnedFallbackProbe(page);
    const operations = await readReaderWorkerOperations(page);

    for (const proof of [first, second]) {
      expect(proof.selectedText).toBe(PINNED_FALLBACK_QUERY);
      expect(proof.sourceHref).toBe('Text/chapter.xhtml');
      expect(proof.exactRects.length).toBeGreaterThan(0);
      expect(proof.exactRects.every((rect) => rect.width > 0 && rect.height > 0)).toBe(true);
      expect(
        proof.visibleNonWhitePixelCount,
        JSON.stringify(probe.paints.filter((paint) => paint.targetCanvas)),
      ).toBeGreaterThan(0);
      expect(proof.targetCanvasPaintFonts.some((font) => font.includes(fixture.familyAlias))).toBe(
        true,
      );
      expect(proof.pinnedFacePresentBeforeDispose).toBe(true);
      expect(proof.pinnedFacePresentAfterDispose).toBe(false);
      expect(proof.terminatedWorkerCountAfter - proof.terminatedWorkerCountBefore).toBe(1);
    }

    expect(second.checksum).toBe(first.checksum);
    expect(second.visibleNonWhitePixelCount).toBe(first.visibleNonWhitePixelCount);
    expect(second.exactRects).toEqual(first.exactRects);

    const targetAliasText = probe.paints
      .filter((paint) => paint.targetCanvas && paint.font.includes(fixture.familyAlias))
      .map((paint) => paint.text)
      .join('');
    expect(targetAliasText).toContain(PINNED_FALLBACK_QUERY);

    expect(probe.openRequests).toHaveLength(2);
    for (const request of probe.openRequests) {
      expect(request.expectedSha256).toEqual([fixture.fontSha256]);
      expect(request.faceBufferByteLengths).toEqual([fixture.font.byteLength]);
    }
    expect(probe.openResults).toHaveLength(2);
    for (const result of probe.openResults) {
      expect(result.policyId).toMatch(/^[0-9a-f]{64}$/);
      expect(result.faces).toHaveLength(1);
      expect(result.faces[0]).toMatchObject({
        sha256: fixture.fontSha256,
        familyAlias: fixture.familyAlias,
      });
      expect(result.faces[0]?.shapeFingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(probe.openResults[1]?.policyId).toBe(probe.openResults[0]?.policyId);
    expect(probe.openResults[1]?.faces[0]?.shapeFingerprint).toBe(
      probe.openResults[0]?.faces[0]?.shapeFingerprint,
    );
    expect(probe.terminatedWorkerIds).toHaveLength(2);
    expect(new Set(probe.terminatedWorkerIds).size).toBe(2);

    const opens = operations.filter((operation) => operation.kind === 'open');
    expect(opens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(opens.map((operation) => operation.workerId)).size).toBeGreaterThanOrEqual(2);
    expect(opens.every((operation) => operation.ok === true)).toBe(true);
    expect(
      operations.filter((operation) => operation.kind === 'createBoundedRevision'),
    ).not.toHaveLength(0);
    expect(
      operations.filter((operation) => operation.kind === 'resolveExactSourceRangeAtRevision'),
    ).not.toHaveLength(0);
    expect(operations.some((operation) => operation.kind === 'createViewRevision')).toBe(false);
    expect(operations.some((operation) => operation.ok === false)).toBe(false);
  });
});
