import type { StyledNode } from '../../style/core/types';
import { layoutBlocks } from '../block';
import type { ImageSizeMap } from '../block/types';
import type { LayoutBlock, LineBox } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { flattenInlineContent } from '../text/styled-segment';

export function layoutTableCellContent(
  cell: StyledNode,
  width: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
): readonly (LineBox | LayoutBlock)[] {
  const hasBlockChildren = cell.children.some((child) => {
    return child.type === 'block' || child.type === 'image';
  });

  if (hasBlockChildren) {
    return layoutBlocks(cell.children, width, layouter, imageSizes);
  }

  const segments = flattenInlineContent(cell.children);
  if (segments.length === 0) return [];
  return layouter.layoutParagraph(segments, width, 0);
}
