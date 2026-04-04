import {
  parseFontStyle,
  parseFontWeight,
  parseLineHeight,
  parseListStyleType,
  parseTextAlign,
  parseTextDecoration,
  parseTextTransform,
  parseVerticalAlign,
  parseWhiteSpace,
} from '../value-parsers';
import { assignLength } from './helpers';
import type { PropertyHandlers } from './types';

export const TEXT_PROPERTY_HANDLERS: PropertyHandlers = {
  color: (result, value) => {
    result.color = value;
  },
  'font-size': (result, value, emBase, rootFontSize) => {
    assignLength(result, 'fontSize', value, emBase, rootFontSize);
  },
  'font-family': (result, value) => {
    result.fontFamily = value;
  },
  'font-weight': (result, value) => {
    const fontWeight = parseFontWeight(value);
    if (fontWeight !== undefined) result.fontWeight = fontWeight;
  },
  'font-style': (result, value) => {
    const fontStyle = parseFontStyle(value);
    if (fontStyle !== undefined) result.fontStyle = fontStyle;
  },
  'line-height': (result, value, emBase, rootFontSize) => {
    const lineHeight = parseLineHeight(value, emBase, rootFontSize);
    if (lineHeight !== undefined) result.lineHeight = lineHeight;
  },
  'letter-spacing': (result, value, emBase, rootFontSize) => {
    assignLength(result, 'letterSpacing', value, emBase, rootFontSize);
  },
  'word-spacing': (result, value, emBase, rootFontSize) => {
    assignLength(result, 'wordSpacing', value, emBase, rootFontSize);
  },
  'text-align': (result, value) => {
    const textAlign = parseTextAlign(value);
    if (textAlign !== undefined) result.textAlign = textAlign;
  },
  'text-decoration': (result, value) => {
    const textDecoration = parseTextDecoration(value);
    if (textDecoration !== undefined) result.textDecoration = textDecoration;
  },
  'text-indent': (result, value, emBase, rootFontSize) => {
    assignLength(result, 'textIndent', value, emBase, rootFontSize);
  },
  'text-transform': (result, value) => {
    const textTransform = parseTextTransform(value);
    if (textTransform !== undefined) result.textTransform = textTransform;
  },
  'white-space': (result, value) => {
    const whiteSpace = parseWhiteSpace(value);
    if (whiteSpace !== undefined) result.whiteSpace = whiteSpace;
  },
  'vertical-align': (result, value) => {
    const verticalAlign = parseVerticalAlign(value);
    if (verticalAlign !== undefined) result.verticalAlign = verticalAlign;
  },
  'list-style-type': (result, value) => {
    const listStyleType = parseListStyleType(value);
    if (listStyleType !== undefined) result.listStyleType = listStyleType;
  },
  'list-style': (result, value) => {
    for (const token of value.trim().split(/\s+/)) {
      const listStyleType = parseListStyleType(token);
      if (listStyleType !== undefined) {
        result.listStyleType = listStyleType;
        return;
      }
    }
  },
};
