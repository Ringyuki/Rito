import { parseDisplay, parsePageBreak } from '../value-parsers';
import { assignLength } from './helpers';
import type { PropertyHandlers } from './types';

/**
 * Percentage sizing for layout properties is intentionally not resolved here.
 *
 * CSS percentages on width/height/max-width/min-height/max-height depend on the
 * containing block, but the style parser only knows the inherited font-size at
 * this stage. Resolving `%` here would incorrectly treat it as font-relative and
 * can cause severe regressions such as `width: 100%` collapsing to ~16px.
 *
 * Current policy: ignore bare percentage values until containing-block-based
 * percentage resolution is modeled explicitly in layout.
 */
function isPercentage(value: string): boolean {
  return value.trim().endsWith('%') && !value.includes('calc');
}

export const LAYOUT_PROPERTY_HANDLERS: PropertyHandlers = {
  display: (result, value) => {
    const display = parseDisplay(value);
    if (display !== undefined) result.display = display;
  },
  float: (result, value) => {
    const float = value.trim().toLowerCase();
    if (float === 'left' || float === 'right' || float === 'none') {
      result.float = float;
    }
  },
  clear: (result, value) => {
    const clear = value.trim().toLowerCase();
    if (clear === 'left' || clear === 'right' || clear === 'both' || clear === 'none') {
      result.clear = clear;
    }
  },
  width: (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'width', value, emBase, rootFontSize, (width) => width > 0);
  },
  'max-width': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'maxWidth', value, emBase, rootFontSize, (width) => width > 0);
  },
  height: (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'height', value, emBase, rootFontSize, (height) => height > 0);
  },
  'min-height': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'minHeight', value, emBase, rootFontSize, (height) => height > 0);
  },
  'max-height': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'maxHeight', value, emBase, rootFontSize, (height) => height > 0);
  },
  overflow: (result, value) => {
    const overflow = value.trim().toLowerCase();
    if (overflow === 'visible' || overflow === 'hidden') {
      result.overflow = overflow;
    }
  },
  'page-break-before': (result, value) => {
    const pageBreakBefore = parsePageBreak(value);
    if (pageBreakBefore !== undefined) result.pageBreakBefore = pageBreakBefore;
  },
  'page-break-after': (result, value) => {
    const pageBreakAfter = parsePageBreak(value);
    if (pageBreakAfter !== undefined) result.pageBreakAfter = pageBreakAfter;
  },
  'break-before': (result, value) => {
    const breakBefore = parsePageBreak(value);
    if (breakBefore !== undefined) result.pageBreakBefore = breakBefore;
  },
  'break-after': (result, value) => {
    const breakAfter = parsePageBreak(value);
    if (breakAfter !== undefined) result.pageBreakAfter = breakAfter;
  },
  position: (result, value) => {
    const position = value.trim().toLowerCase();
    if (position === 'static' || position === 'relative') {
      result.position = position;
    }
  },
  top: (result, value, emBase, rootFontSize) => {
    assignLength(result, 'top', value, emBase, rootFontSize);
  },
  left: (result, value, emBase, rootFontSize) => {
    assignLength(result, 'left', value, emBase, rootFontSize);
  },
  bottom: (result, value, emBase, rootFontSize) => {
    assignLength(result, 'bottom', value, emBase, rootFontSize);
  },
  right: (result, value, emBase, rootFontSize) => {
    assignLength(result, 'right', value, emBase, rootFontSize);
  },
  orphans: (result, value) => {
    const num = parseInt(value.trim(), 10);
    if (!isNaN(num) && num >= 1) result.orphans = num;
  },
  widows: (result, value) => {
    const num = parseInt(value.trim(), 10);
    if (!isNaN(num) && num >= 1) result.widows = num;
  },
};
