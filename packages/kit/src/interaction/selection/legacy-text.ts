import { getFirstTextPosition, getLastTextPosition } from '../core/text-traversal';
import type { TextRange } from '../core/types';
import type { Spread } from '../layout-types';
import { getSelectedText } from './range';
import type { AnchoredPosition } from './spread';

export function getLegacySelectionText(
  spread: Spread | undefined,
  anchor: AnchoredPosition | undefined,
  focus: AnchoredPosition | undefined,
  range: TextRange | null,
): string {
  if (!range || !spread || !anchor || !focus) return '';
  if (anchor.pageIndex === focus.pageIndex) {
    const page = anchor.pageIndex === spread.left?.index ? spread.left : spread.right;
    return page ? getSelectedText(page, range) : '';
  }

  const [startAnchor, endAnchor] =
    anchor.pageIndex < focus.pageIndex ? [anchor, focus] : [focus, anchor];
  const startPage = startAnchor.pageIndex === spread.left?.index ? spread.left : spread.right;
  const endPage = endAnchor.pageIndex === spread.left?.index ? spread.left : spread.right;
  const startEnd = startPage ? getLastTextPosition(startPage) : undefined;
  const endStart = endPage ? getFirstTextPosition(endPage) : undefined;
  const startText =
    startPage && startEnd
      ? getSelectedText(startPage, { start: startAnchor.position, end: startEnd })
      : '';
  const endText =
    endPage && endStart
      ? getSelectedText(endPage, { start: endStart, end: endAnchor.position })
      : '';
  return startText + endText;
}
