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
import { pinnedFaceOpens, readReaderSessionLog } from './reader-session-log';

test.describe('production pinned fallback', () => {
  test.beforeAll(async () => {
    await buildPinnedFallbackProductionCore();
  });

  test('keeps Rust shape identity, Canvas paint, exact geometry, and disposal stable', async ({
    page,
  }) => {
    const fixture = await createPinnedFallbackFixture();
    await installPinnedFallbackProbe(page);
    await installPinnedFallbackHarness(page, fixture);
    await openPinnedFallbackHarness(page);

    const first = await runPinnedFallbackCycle(page, fixture);
    const second = await runPinnedFallbackCycle(page, fixture);
    const probe = await readPinnedFallbackProbe(page);
    const log = await readReaderSessionLog(page);

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
      expect(proof.disposedSessionCountAfter - proof.disposedSessionCountBefore).toBe(1);
    }

    expect(second.checksum).toBe(first.checksum);
    expect(second.visibleNonWhitePixelCount).toBe(first.visibleNonWhitePixelCount);
    expect(second.exactRects).toEqual(first.exactRects);

    const targetAliasText = probe.paints
      .filter((paint) => paint.targetCanvas && paint.font.includes(fixture.familyAlias))
      .map((paint) => paint.text)
      .join('');
    expect(targetAliasText).toContain(PINNED_FALLBACK_QUERY);

    // One session per cycle, each opened with the fixture face. The engine
    // refuses a face whose bytes do not hash to its SHA-256, so a session
    // that opened was handed the whole font.
    const opens = pinnedFaceOpens(log);
    expect(opens).toHaveLength(2);
    for (const open of opens) {
      expect(open.sha256).toEqual([fixture.fontSha256]);
      expect(open.ok).toBe(true);
    }
    expect(new Set(opens.map((open) => open.reader)).size).toBe(2);
    expect(log.filter((entry) => entry.kind === 'exactSourceRange')).not.toHaveLength(0);
    expect(log.some((entry) => entry.ok === false)).toBe(false);
  });
});
