import { applyBoxShorthand, applyBoxShorthandWithAuto } from '../parse-utils';
import { assignLength, assignMarginLength, isPercentage } from './helpers';
import type { PropertyHandlers } from './types';

const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

export const SPACING_PROPERTY_HANDLERS: PropertyHandlers = {
  'margin-top': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'marginTop', value, emBase, rootFontSize);
  },
  'margin-right': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignMarginLength(result, 'marginRight', value, emBase, rootFontSize);
  },
  'margin-bottom': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'marginBottom', value, emBase, rootFontSize);
  },
  'margin-left': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignMarginLength(result, 'marginLeft', value, emBase, rootFontSize);
  },
  margin: (result, value, emBase, rootFontSize) => {
    applyBoxShorthandWithAuto(result, value, emBase, MARGIN_KEYS, rootFontSize);
  },
  'padding-top': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'paddingTop', value, emBase, rootFontSize);
  },
  'padding-right': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'paddingRight', value, emBase, rootFontSize);
  },
  'padding-bottom': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'paddingBottom', value, emBase, rootFontSize);
  },
  'padding-left': (result, value, emBase, rootFontSize) => {
    if (isPercentage(value)) return;
    assignLength(result, 'paddingLeft', value, emBase, rootFontSize);
  },
  padding: (result, value, emBase, rootFontSize) => {
    applyBoxShorthand(result, value, emBase, PADDING_KEYS, rootFontSize);
  },
};
