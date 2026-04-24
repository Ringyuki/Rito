import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { PixelGoldenRun } from './pixel-cases';
import type { PixelReviewReferenceInput } from './pixel-review';
import type { PixelReferenceHint, PixelReviewReferenceProvider } from './pixel-run-assertions';
import type { PixelReferenceBook, PixelRenderServer } from './render-server';

export function createPixelReviewReferenceProvider(
  page: Page,
  server: PixelRenderServer,
  run: PixelGoldenRun,
  bookBytes: Buffer,
): PixelReviewReferenceProvider {
  const skipped = referenceSkipReason(run);
  let referenceBookPromise: Promise<PixelReferenceBook> | undefined;

  return async (spread) => {
    if (skipped) return { skipped };
    referenceBookPromise ??= server.registerReferenceBook(run.bookId, bookBytes);
    try {
      const referenceBook = await referenceBookPromise;
      const referenceUrl = (chapterHref: string): string => referenceBook.referenceUrl(chapterHref);
      return await captureReferenceImage(page, referenceUrl, run, spread.reference);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
}

function referenceSkipReason(run: PixelGoldenRun): string | undefined {
  if (run.profile.spread !== 'single')
    return 'Browser XHTML reference is only captured for single-page profiles.';
  if (run.profile.devicePixelRatio !== 1)
    return 'Browser XHTML reference is only captured for DPR 1 profiles.';
  return undefined;
}

async function captureReferenceImage(
  page: Page,
  referenceUrl: (chapterHref: string) => string,
  run: PixelGoldenRun,
  hint: PixelReferenceHint | undefined,
): Promise<PixelReviewReferenceInput> {
  if (!hint?.chapterHref) return { skipped: 'No chapter href was available for this spread.' };

  try {
    await page.setViewportSize({ width: run.profile.width, height: run.profile.height });
    await page.goto(referenceUrl(hint.chapterHref), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready.catch(() => undefined);
    });
    await applyReferencePageFrame(page, run.profile);
    const targetFound = await scrollToReferenceTarget(page, hint.textPreview, run.profile.margin);
    const png = await page.screenshot({ type: 'png' });
    const size = PNG.sync.read(png);
    return {
      png,
      width: size.width,
      height: size.height,
      label: 'Browser XHTML',
      sourceHref: hint.chapterHref,
      targetFound,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function applyReferencePageFrame(
  page: Page,
  profile: PixelGoldenRun['profile'],
): Promise<void> {
  if (profile.margin <= 0) return;
  await page.evaluate(
    ({
      margin,
      width,
      height,
    }: {
      readonly margin: number;
      readonly width: number;
      readonly height: number;
    }) => {
      const existing = document.getElementById('__rito_pixel_reference_page__');
      if (existing) return;

      const wrapper = document.createElement('div');
      wrapper.id = '__rito_pixel_reference_page__';
      wrapper.style.width = `${String(width - margin * 2)}px`;
      wrapper.style.minHeight = `${String(height - margin * 2)}px`;
      wrapper.style.margin = '0 auto';
      wrapper.style.paddingTop = `${String(margin)}px`;
      wrapper.style.paddingBottom = `${String(margin)}px`;
      wrapper.style.boxSizing = 'border-box';

      while (document.body.firstChild) wrapper.appendChild(document.body.firstChild);
      document.body.appendChild(wrapper);
    },
    {
      margin: profile.margin,
      width: profile.width,
      height: profile.height,
    },
  );
}

async function scrollToReferenceTarget(
  page: Page,
  textPreview: string | undefined,
  margin: number,
): Promise<boolean> {
  if (!textPreview) return false;
  return await page.evaluate(
    ({ margin, textPreview }: { readonly margin: number; readonly textPreview: string }) => {
      const target = findReferenceTarget(textPreview);
      if (!target) return false;
      const targetTop = target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ left: 0, top: Math.max(0, targetTop - margin) });
      return true;

      function findReferenceTarget(text: string): Element | undefined {
        const snippets = referenceSnippets(text);
        if (snippets.length === 0) return undefined;
        const candidates = Array.from(document.body.querySelectorAll('*')).filter(
          (element) =>
            element.id !== '__rito_pixel_reference_page__' &&
            snippets.some((snippet) => matchesSnippet(element.textContent || '', snippet)),
        );
        return (
          candidates.find(
            (element) =>
              !Array.from(element.children).some((child) =>
                snippets.some((snippet) => matchesSnippet(child.textContent || '', snippet)),
              ),
          ) ||
          candidates.at(-1) ||
          undefined
        );
      }

      function matchesSnippet(
        text: string,
        snippet: { readonly loose: string; readonly compact: string },
      ): boolean {
        const loose = normalizeText(text);
        const compact = compactText(text);
        return (
          (snippet.loose.length > 0 && loose.includes(snippet.loose)) ||
          (snippet.compact.length > 0 && compact.includes(snippet.compact))
        );
      }

      function referenceSnippets(
        text: string,
      ): readonly { readonly loose: string; readonly compact: string }[] {
        const normalized = normalizeText(text);
        const compact = compactText(text);
        return [120, 80, 48, 24]
          .map((length) => ({
            loose: normalized.slice(0, length).trim(),
            compact: compact.slice(0, length).trim(),
          }))
          .filter(
            (snippet, index, snippets) =>
              (snippet.loose.length >= 8 || snippet.compact.length >= 8) &&
              snippets.findIndex(
                (item) => item.loose === snippet.loose && item.compact === snippet.compact,
              ) === index,
          );
      }

      function normalizeText(text: string): string {
        return text.replace(/\s+/g, ' ').trim();
      }

      function compactText(text: string): string {
        return text.replace(/\s+/g, '');
      }
    },
    { margin, textPreview },
  );
}
