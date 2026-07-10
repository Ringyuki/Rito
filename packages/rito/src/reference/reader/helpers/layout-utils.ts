import { createLayoutConfig, type LayoutConfigInput } from '../../ts-core/layout/core/config';
import type { LayoutConfig } from '../../ts-core/layout/core/types';
import type { ReaderOptions } from '../../../reader';
import type { ChapterRange } from '../../ts-core/runtime/types';

export function makeLayoutConfig(
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
  rootFontSize?: number,
  lineHeightOverride?: number,
  fontFamilyOverride?: string,
  lineHeightForce?: boolean,
  fontFamilyForce?: boolean,
): LayoutConfig {
  return createLayoutConfig({
    width: options.width,
    height: options.height,
    margin: options.margin ?? 40,
    spread: spreadMode,
    spreadGap: options.spreadGap ?? 20,
    ...(rootFontSize !== undefined ? { rootFontSize } : {}),
    ...(lineHeightOverride !== undefined ? { lineHeightOverride } : {}),
    ...(lineHeightForce !== undefined ? { lineHeightForce } : {}),
    ...(fontFamilyOverride !== undefined ? { fontFamilyOverride } : {}),
    ...(fontFamilyForce !== undefined ? { fontFamilyForce } : {}),
    ...(options.paginationPolicy !== undefined
      ? { paginationPolicy: options.paginationPolicy }
      : {}),
  } satisfies LayoutConfigInput);
}

export function getChapterStartPages(chapterMap: ReadonlyMap<string, ChapterRange>): Set<number> {
  const starts = new Set<number>();
  for (const range of chapterMap.values()) {
    starts.add(range.startPage);
  }
  return starts;
}

const LAYOUT_CONFIG_FIELDS = [
  'viewportWidth',
  'viewportHeight',
  'pageWidth',
  'pageHeight',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'spreadMode',
  'firstPageAlone',
  'spreadGap',
  'rootFontSize',
  'lineHeightOverride',
  'fontFamilyOverride',
] as const satisfies readonly (keyof LayoutConfig)[];

export function layoutConfigEqual(a: LayoutConfig, b: LayoutConfig): boolean {
  return (
    layoutFieldsEqual(a, b) &&
    flagEqual(a.lineHeightForce, b.lineHeightForce) &&
    flagEqual(a.fontFamilyForce, b.fontFamilyForce) &&
    paginationPolicyEqual(a.paginationPolicy, b.paginationPolicy)
  );
}

function layoutFieldsEqual(a: LayoutConfig, b: LayoutConfig): boolean {
  return LAYOUT_CONFIG_FIELDS.every((field) => a[field] === b[field]);
}

function flagEqual(a: boolean | undefined, b: boolean | undefined): boolean {
  return (a ?? false) === (b ?? false);
}

function paginationPolicyEqual(
  a: LayoutConfig['paginationPolicy'],
  b: LayoutConfig['paginationPolicy'],
): boolean {
  return (
    a?.enabled === b?.enabled &&
    a?.defaultOrphans === b?.defaultOrphans &&
    a?.defaultWidows === b?.defaultWidows
  );
}
