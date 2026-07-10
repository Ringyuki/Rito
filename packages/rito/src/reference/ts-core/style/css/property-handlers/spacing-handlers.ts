import { applyBoxShorthand, applyBoxShorthandWithAuto } from '../parse-utils';
import { assignLength, assignMarginLength, isPercentage } from './helpers';
import type { MutableStylePatch } from '../../core/style-patch';
import type { PropertyHandlers } from './types';

const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

type PctKey =
  | 'marginTopPct'
  | 'marginRightPct'
  | 'marginBottomPct'
  | 'marginLeftPct'
  | 'paddingTopPct'
  | 'paddingRightPct'
  | 'paddingBottomPct'
  | 'paddingLeftPct';

function assignPercentage(result: MutableStylePatch, key: PctKey, value: string): boolean {
  if (!isPercentage(value)) return false;
  const pct = parseFloat(value.trim());
  if (!isNaN(pct)) result[key] = pct;
  return true;
}

export const SPACING_PROPERTY_HANDLERS: PropertyHandlers = {
  'margin-top': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'marginTopPct', value)) return;
    assignLength(result, 'marginTop', value, emBase, rootFontSize, undefined, viewport);
  },
  'margin-right': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'marginRightPct', value)) return;
    assignMarginLength(result, 'marginRight', value, emBase, rootFontSize, viewport);
  },
  'margin-bottom': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'marginBottomPct', value)) return;
    assignLength(result, 'marginBottom', value, emBase, rootFontSize, undefined, viewport);
  },
  'margin-left': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'marginLeftPct', value)) return;
    assignMarginLength(result, 'marginLeft', value, emBase, rootFontSize, viewport);
  },
  margin: (result, value, emBase, rootFontSize, viewport) => {
    applyBoxShorthandWithAuto(result, value, emBase, MARGIN_KEYS, rootFontSize, viewport);
  },
  'padding-top': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'paddingTopPct', value)) return;
    assignLength(result, 'paddingTop', value, emBase, rootFontSize, undefined, viewport);
  },
  'padding-right': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'paddingRightPct', value)) return;
    assignLength(result, 'paddingRight', value, emBase, rootFontSize, undefined, viewport);
  },
  'padding-bottom': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'paddingBottomPct', value)) return;
    assignLength(result, 'paddingBottom', value, emBase, rootFontSize, undefined, viewport);
  },
  'padding-left': (result, value, emBase, rootFontSize, viewport) => {
    if (assignPercentage(result, 'paddingLeftPct', value)) return;
    assignLength(result, 'paddingLeft', value, emBase, rootFontSize, undefined, viewport);
  },
  padding: (result, value, emBase, rootFontSize, viewport) => {
    applyBoxShorthand(result, value, emBase, PADDING_KEYS, rootFontSize, viewport);
  },
};
