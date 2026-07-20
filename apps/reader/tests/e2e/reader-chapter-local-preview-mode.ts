import type { BrowserContext, Page } from '@playwright/test';

const CHAPTER_LOCAL_PREVIEW_GATE = '@ritojs/core/browser/chapter-local-preview';

export type ReaderChapterLocalPreviewMode = 'enabled' | 'disabled';

type InitScriptTarget = Pick<Page, 'addInitScript'> | Pick<BrowserContext, 'addInitScript'>;

interface ChapterLocalPreviewGateRuntime {
  [key: symbol]: unknown;
}

export function readerChapterLocalPreviewModeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ReaderChapterLocalPreviewMode {
  return env['RITO_READER_DISABLE_CHAPTER_LOCAL_PREVIEW'] === '1' ? 'disabled' : 'enabled';
}

/** Installs the explicit A/B off switch before the first navigation. Enabled is the product default. */
export async function installReaderChapterLocalPreviewMode(
  target: InitScriptTarget,
  mode: ReaderChapterLocalPreviewMode,
): Promise<void> {
  if (mode === 'enabled') return;
  await target.addInitScript((gate) => {
    const runtime = globalThis as typeof globalThis & ChapterLocalPreviewGateRuntime;
    runtime[Symbol.for(gate)] = false;
  }, CHAPTER_LOCAL_PREVIEW_GATE);
}

export function readReaderChapterLocalPreviewMode(
  page: Page,
): Promise<ReaderChapterLocalPreviewMode> {
  return page.evaluate((gate) => {
    const runtime = globalThis as typeof globalThis & ChapterLocalPreviewGateRuntime;
    return runtime[Symbol.for(gate)] === false ? 'disabled' : 'enabled';
  }, CHAPTER_LOCAL_PREVIEW_GATE);
}
