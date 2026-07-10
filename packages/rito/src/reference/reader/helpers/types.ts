import type { LayoutConfig, Spread } from '../../ts-core/layout/core/types';
import type { LoadedAssets } from '../../ts-core/render/web';
import type { Resources } from '../resources';
import type { Logger } from '../../ts-core/utils/logger';

export type SpreadRenderedCallback = (spreadIndex: number, spread: Spread) => void;

export interface ReaderState {
  readonly logger: Logger;
  spreadMode: 'single' | 'double';
  lineBreaking: 'greedy' | 'optimal';
  bgColor: string;
  fgColor: string | undefined;
  dpr: number;
  config: LayoutConfig;
  assets: LoadedAssets;
  resources: Resources;
  spreads: readonly Spread[];
  spreadRenderedListeners: Set<SpreadRenderedCallback>;
  /** User font size override. When set, used as rootFontSize during repagination. */
  fontSizeOverride: number | undefined;
  /** User line-height multiplier override. Cascades via body style. */
  lineHeightOverride: number | undefined;
  /** When true (and lineHeightOverride is set), force on every element, bypassing element-level CSS. */
  lineHeightForce: boolean;
  /** User font-family override. Cascades via body style. */
  fontFamilyOverride: string | undefined;
  /** When true (and fontFamilyOverride is set), force on every element, bypassing element-level CSS. */
  fontFamilyForce: boolean;
}
