/**
 * Layout computation types.
 * Layout must not depend on Canvas APIs.
 */

import type { Rect } from '../model/types';
import type { ComputedStyle } from '../style/types';

/** A laid-out text run within a line. */
export interface TextRun {
  readonly type: 'text-run';
  readonly text: string;
  readonly bounds: Rect;
  readonly style: ComputedStyle;
}

/** A laid-out line box containing text runs. */
export interface LineBox {
  readonly type: 'line-box';
  readonly bounds: Rect;
  readonly runs: readonly TextRun[];
}

/** A laid-out block containing line boxes or nested blocks. */
export interface LayoutBlock {
  readonly type: 'layout-block';
  readonly bounds: Rect;
  readonly children: readonly (LineBox | LayoutBlock)[];
}

/** Configuration for the layout engine. */
export interface LayoutConfig {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
}
