import { applyBoxShorthand, applyBoxShorthandWithAuto, parseLength } from './parse-utils';
import {
  parseBorder,
  parseDisplay,
  parseFontStyle,
  parseFontWeight,
  parseLineHeight,
  parseListStyleType,
  parsePageBreak,
  parseTextAlign,
  parseTextDecoration,
  parseTextTransform,
  parseVerticalAlign,
  parseWhiteSpace,
} from './css-value-parsers';

export type PropertyHandler = (
  result: Record<string, unknown>,
  value: string,
  emBase: number,
  rootFontSize: number,
) => void;

const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

export const PROPERTY_HANDLERS: Readonly<Record<string, PropertyHandler>> = {
  color: (result, value) => {
    result['color'] = value;
  },
  'font-size': (result, value, emBase, rootFontSize) => {
    const fontSize = parseLength(value, emBase, rootFontSize);
    if (fontSize !== undefined) result['fontSize'] = fontSize;
  },
  'font-family': (result, value) => {
    result['fontFamily'] = value;
  },
  'font-weight': (result, value) => {
    const fontWeight = parseFontWeight(value);
    if (fontWeight !== undefined) result['fontWeight'] = fontWeight;
  },
  'font-style': (result, value) => {
    const fontStyle = parseFontStyle(value);
    if (fontStyle !== undefined) result['fontStyle'] = fontStyle;
  },
  'line-height': (result, value, emBase, rootFontSize) => {
    const lineHeight = parseLineHeight(value, emBase, rootFontSize);
    if (lineHeight !== undefined) result['lineHeight'] = lineHeight;
  },
  'letter-spacing': (result, value, emBase, rootFontSize) => {
    const letterSpacing = parseLength(value, emBase, rootFontSize);
    if (letterSpacing !== undefined) result['letterSpacing'] = letterSpacing;
  },
  'word-spacing': (result, value, emBase, rootFontSize) => {
    const wordSpacing = parseLength(value, emBase, rootFontSize);
    if (wordSpacing !== undefined) result['wordSpacing'] = wordSpacing;
  },
  'text-align': (result, value) => {
    const textAlign = parseTextAlign(value);
    if (textAlign !== undefined) result['textAlign'] = textAlign;
  },
  'text-decoration': (result, value) => {
    const textDecoration = parseTextDecoration(value);
    if (textDecoration !== undefined) result['textDecoration'] = textDecoration;
  },
  'text-indent': (result, value, emBase, rootFontSize) => {
    const textIndent = parseLength(value, emBase, rootFontSize);
    if (textIndent !== undefined) result['textIndent'] = textIndent;
  },
  'text-transform': (result, value) => {
    const textTransform = parseTextTransform(value);
    if (textTransform !== undefined) result['textTransform'] = textTransform;
  },
  'white-space': (result, value) => {
    const whiteSpace = parseWhiteSpace(value);
    if (whiteSpace !== undefined) result['whiteSpace'] = whiteSpace;
  },
  'margin-top': (result, value, emBase, rootFontSize) => {
    const marginTop = parseLength(value, emBase, rootFontSize);
    if (marginTop !== undefined) result['marginTop'] = marginTop;
  },
  'margin-right': (result, value, emBase, rootFontSize) => {
    if (value.trim().toLowerCase() === 'auto') {
      result['marginRight'] = 0;
      result['marginRightAuto'] = true;
      return;
    }
    const marginRight = parseLength(value, emBase, rootFontSize);
    if (marginRight !== undefined) {
      result['marginRight'] = marginRight;
      result['marginRightAuto'] = false;
    }
  },
  'margin-bottom': (result, value, emBase, rootFontSize) => {
    const marginBottom = parseLength(value, emBase, rootFontSize);
    if (marginBottom !== undefined) result['marginBottom'] = marginBottom;
  },
  'margin-left': (result, value, emBase, rootFontSize) => {
    if (value.trim().toLowerCase() === 'auto') {
      result['marginLeft'] = 0;
      result['marginLeftAuto'] = true;
      return;
    }
    const marginLeft = parseLength(value, emBase, rootFontSize);
    if (marginLeft !== undefined) {
      result['marginLeft'] = marginLeft;
      result['marginLeftAuto'] = false;
    }
  },
  margin: (result, value, emBase, rootFontSize) => {
    applyBoxShorthandWithAuto(result, value, emBase, MARGIN_KEYS, rootFontSize);
  },
  'padding-top': (result, value, emBase, rootFontSize) => {
    const paddingTop = parseLength(value, emBase, rootFontSize);
    if (paddingTop !== undefined) result['paddingTop'] = paddingTop;
  },
  'padding-right': (result, value, emBase, rootFontSize) => {
    const paddingRight = parseLength(value, emBase, rootFontSize);
    if (paddingRight !== undefined) result['paddingRight'] = paddingRight;
  },
  'padding-bottom': (result, value, emBase, rootFontSize) => {
    const paddingBottom = parseLength(value, emBase, rootFontSize);
    if (paddingBottom !== undefined) result['paddingBottom'] = paddingBottom;
  },
  'padding-left': (result, value, emBase, rootFontSize) => {
    const paddingLeft = parseLength(value, emBase, rootFontSize);
    if (paddingLeft !== undefined) result['paddingLeft'] = paddingLeft;
  },
  padding: (result, value, emBase, rootFontSize) => {
    applyBoxShorthand(result, value, emBase, PADDING_KEYS, rootFontSize);
  },
  border: (result, value, emBase, rootFontSize) => {
    const border = parseBorder(value, emBase, rootFontSize);
    if (!border) return;
    result['borderTop'] = border;
    result['borderRight'] = border;
    result['borderBottom'] = border;
    result['borderLeft'] = border;
  },
  'border-top': (result, value, emBase, rootFontSize) => {
    const borderTop = parseBorder(value, emBase, rootFontSize);
    if (borderTop) result['borderTop'] = borderTop;
  },
  'border-right': (result, value, emBase, rootFontSize) => {
    const borderRight = parseBorder(value, emBase, rootFontSize);
    if (borderRight) result['borderRight'] = borderRight;
  },
  'border-bottom': (result, value, emBase, rootFontSize) => {
    const borderBottom = parseBorder(value, emBase, rootFontSize);
    if (borderBottom) result['borderBottom'] = borderBottom;
  },
  'border-left': (result, value, emBase, rootFontSize) => {
    const borderLeft = parseBorder(value, emBase, rootFontSize);
    if (borderLeft) result['borderLeft'] = borderLeft;
  },
  'vertical-align': (result, value) => {
    const verticalAlign = parseVerticalAlign(value);
    if (verticalAlign !== undefined) result['verticalAlign'] = verticalAlign;
  },
  display: (result, value) => {
    const display = parseDisplay(value);
    if (display !== undefined) result['display'] = display;
  },
  float: (result, value) => {
    const float = value.trim().toLowerCase();
    if (float === 'left' || float === 'right' || float === 'none') result['float'] = float;
  },
  clear: (result, value) => {
    const clear = value.trim().toLowerCase();
    if (clear === 'left' || clear === 'right' || clear === 'both' || clear === 'none') {
      result['clear'] = clear;
    }
  },
  width: (result, value, emBase, rootFontSize) => {
    const width = parseLength(value, emBase, rootFontSize);
    if (width !== undefined && width > 0) result['width'] = width;
  },
  'max-width': (result, value, emBase, rootFontSize) => {
    const maxWidth = parseLength(value, emBase, rootFontSize);
    if (maxWidth !== undefined && maxWidth > 0) result['maxWidth'] = maxWidth;
  },
  height: (result, value, emBase, rootFontSize) => {
    const height = parseLength(value, emBase, rootFontSize);
    if (height !== undefined && height > 0) result['height'] = height;
  },
  'min-height': (result, value, emBase, rootFontSize) => {
    const minHeight = parseLength(value, emBase, rootFontSize);
    if (minHeight !== undefined && minHeight > 0) result['minHeight'] = minHeight;
  },
  'max-height': (result, value, emBase, rootFontSize) => {
    const maxHeight = parseLength(value, emBase, rootFontSize);
    if (maxHeight !== undefined && maxHeight > 0) result['maxHeight'] = maxHeight;
  },
  overflow: (result, value) => {
    const overflow = value.trim().toLowerCase();
    if (overflow === 'visible' || overflow === 'hidden') result['overflow'] = overflow;
  },
  'background-color': (result, value) => {
    result['backgroundColor'] = value;
  },
  background: (result, value) => {
    const background = value.trim();
    if (background && !background.includes('url(') && !background.includes('gradient')) {
      result['backgroundColor'] = background.split(/\s+/)[0] ?? '';
    }
  },
  'list-style-type': (result, value) => {
    const listStyleType = parseListStyleType(value);
    if (listStyleType !== undefined) result['listStyleType'] = listStyleType;
  },
  'list-style': (result, value) => {
    for (const token of value.trim().split(/\s+/)) {
      const listStyleType = parseListStyleType(token);
      if (listStyleType !== undefined) {
        result['listStyleType'] = listStyleType;
        return;
      }
    }
  },
  'box-sizing': (result, value) => {
    const boxSizing = value.trim().toLowerCase();
    if (boxSizing === 'border-box' || boxSizing === 'content-box') {
      result['boxSizing'] = boxSizing;
    }
  },
  'page-break-before': (result, value) => {
    const pageBreakBefore = parsePageBreak(value);
    if (pageBreakBefore !== undefined) result['pageBreakBefore'] = pageBreakBefore;
  },
  'page-break-after': (result, value) => {
    const pageBreakAfter = parsePageBreak(value);
    if (pageBreakAfter !== undefined) result['pageBreakAfter'] = pageBreakAfter;
  },
  'break-before': (result, value) => {
    const breakBefore = parsePageBreak(value);
    if (breakBefore !== undefined) result['pageBreakBefore'] = breakBefore;
  },
  'break-after': (result, value) => {
    const breakAfter = parsePageBreak(value);
    if (breakAfter !== undefined) result['pageBreakAfter'] = breakAfter;
  },
  position: (result, value) => {
    const position = value.trim().toLowerCase();
    if (position === 'static' || position === 'relative') result['position'] = position;
  },
  top: (result, value, emBase, rootFontSize) => {
    const top = parseLength(value, emBase, rootFontSize);
    if (top !== undefined) result['top'] = top;
  },
  left: (result, value, emBase, rootFontSize) => {
    const left = parseLength(value, emBase, rootFontSize);
    if (left !== undefined) result['left'] = left;
  },
  bottom: (result, value, emBase, rootFontSize) => {
    const bottom = parseLength(value, emBase, rootFontSize);
    if (bottom !== undefined) result['bottom'] = bottom;
  },
  right: (result, value, emBase, rootFontSize) => {
    const right = parseLength(value, emBase, rootFontSize);
    if (right !== undefined) result['right'] = right;
  },
  'border-radius': (result, value, emBase, rootFontSize) => {
    const borderRadius = parseLength(value, emBase, rootFontSize);
    if (borderRadius !== undefined && borderRadius >= 0) result['borderRadius'] = borderRadius;
  },
  opacity: (result, value) => {
    const opacity = parseFloat(value.trim());
    if (!isNaN(opacity)) result['opacity'] = Math.max(0, Math.min(1, opacity));
  },
};
