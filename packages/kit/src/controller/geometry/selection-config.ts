import { createLayoutConfig } from '@rito/core';
import type { LayoutConfig } from '@rito/core';
import type { LayoutGeometry } from './coordinate-mapper';

export function buildSelectionConfig(
  g: LayoutGeometry,
  contentWidth: number,
  contentHeight: number,
  contentGap: number,
): LayoutConfig {
  return g.spreadMode === 'double'
    ? createLayoutConfig({
        width: 2 * contentWidth + contentGap,
        height: contentHeight,
        spread: 'double',
        spreadGap: contentGap,
      })
    : createLayoutConfig({
        width: contentWidth,
        height: contentHeight,
        spread: 'single',
      });
}
