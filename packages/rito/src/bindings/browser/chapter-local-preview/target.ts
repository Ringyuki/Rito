import type { ReaderLocator, TocEntry } from '../../../reader';
import type { BrowserReaderState } from '../reader/types';
import {
  browserReaderChapterLocalLocatorHasAnchorConflict,
  sameBrowserReaderLocator,
} from './state';

interface BrowserReaderChapterLocalPreviewTarget {
  readonly chapterIndex: number;
  readonly chapterHref: string;
  readonly tocEntry: TocEntry | undefined;
}

export function previewTarget(
  state: BrowserReaderState,
  locator: ReaderLocator,
): BrowserReaderChapterLocalPreviewTarget | undefined {
  if (browserReaderChapterLocalLocatorHasAnchorConflict(locator)) return undefined;
  const initialLocator = state.chapterLocalPreview.initialLocator;
  state.chapterLocalPreview.initialLocator = undefined;
  if (initialLocator && sameBrowserReaderLocator(initialLocator, locator)) return undefined;
  const targetHref = hrefWithoutFragment(locator.href);
  const chapterIndex = state.publication.chapters.findIndex(
    (chapter) => hrefWithoutFragment(chapter.href) === targetHref,
  );
  if (
    chapterIndex < 0 ||
    state.revisionBundle.navigation.chapters[chapterIndex]?.startPage !== undefined
  ) {
    return undefined;
  }
  return {
    chapterIndex,
    chapterHref: hrefWithoutFragment(state.publication.chapters[chapterIndex]?.href ?? targetHref),
    tocEntry: findPreviewTocEntry(state.publication.package.toc, locator),
  };
}

function findPreviewTocEntry(
  entries: readonly TocEntry[],
  locator: ReaderLocator,
): TocEntry | undefined {
  const exactHref = locator.anchorId
    ? `${hrefWithoutFragment(locator.href)}#${locator.anchorId}`
    : locator.href;
  const sameChapter: TocEntry[] = [];
  const visit = (candidates: readonly TocEntry[]): TocEntry | undefined => {
    for (const entry of candidates) {
      if (entry.href === exactHref) return entry;
      if (hrefWithoutFragment(entry.href) === hrefWithoutFragment(locator.href)) {
        sameChapter.push(entry);
      }
      const child = visit(entry.children);
      if (child) return child;
    }
    return undefined;
  };
  return visit(entries) ?? sameChapter[0];
}

function hrefWithoutFragment(href: string): string {
  const fragment = href.indexOf('#');
  return fragment < 0 ? href : href.slice(0, fragment);
}
