import { createLayoutConfig, type LayoutConfigInput } from '../../layout/core/config';
import type { LayoutConfig } from '../../layout/core/types';
import type { ReaderOptions } from '../../reader';
import type { ChapterRange } from '../../runtime/types';

export function makeLayoutConfig(
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
  rootFontSize?: number,
  lineHeightOverride?: number,
  fontFamilyOverride?: string,
): LayoutConfig {
  return createLayoutConfig({
    width: options.width,
    height: options.height,
    margin: options.margin ?? 40,
    spread: spreadMode,
    spreadGap: options.spreadGap ?? 20,
    ...(rootFontSize !== undefined ? { rootFontSize } : {}),
    ...(lineHeightOverride !== undefined ? { lineHeightOverride } : {}),
    ...(fontFamilyOverride !== undefined ? { fontFamilyOverride } : {}),
  } satisfies LayoutConfigInput);
}

export function getChapterStartPages(chapterMap: ReadonlyMap<string, ChapterRange>): Set<number> {
  const starts = new Set<number>();
  for (const range of chapterMap.values()) {
    starts.add(range.startPage);
  }
  return starts;
}

export function layoutConfigEqual(a: LayoutConfig, b: LayoutConfig): boolean {
  return (
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.pageWidth === b.pageWidth &&
    a.pageHeight === b.pageHeight &&
    a.marginTop === b.marginTop &&
    a.marginRight === b.marginRight &&
    a.marginBottom === b.marginBottom &&
    a.marginLeft === b.marginLeft &&
    a.spreadMode === b.spreadMode &&
    a.firstPageAlone === b.firstPageAlone &&
    a.spreadGap === b.spreadGap &&
    a.rootFontSize === b.rootFontSize &&
    a.lineHeightOverride === b.lineHeightOverride &&
    a.fontFamilyOverride === b.fontFamilyOverride
  );
}
