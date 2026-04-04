import type { LayoutConfig, Spread } from '../../layout/core/types';
import type { LoadedAssets, Resources } from '../../render/assets';
import type { Logger } from '../../utils/logger';

export type SpreadRenderedCallback = (spreadIndex: number, spread: Spread) => void;

export interface ReaderState {
  readonly logger: Logger;
  spreadMode: 'single' | 'double';
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
}
