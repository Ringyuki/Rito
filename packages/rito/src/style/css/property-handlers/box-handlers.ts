import { parseLength } from '../parse-utils';
import { parseBorder } from '../value-parsers';
import { isPercentage } from './helpers';
import type { PropertyHandlers } from './types';

export const BOX_PROPERTY_HANDLERS: PropertyHandlers = {
  border: (result, value, emBase, rootFontSize) => {
    const border = parseBorder(value, emBase, rootFontSize);
    if (!border) return;
    result.borderTop = border;
    result.borderRight = border;
    result.borderBottom = border;
    result.borderLeft = border;
  },
  'border-top': (result, value, emBase, rootFontSize) => {
    const borderTop = parseBorder(value, emBase, rootFontSize);
    if (borderTop) result.borderTop = borderTop;
  },
  'border-right': (result, value, emBase, rootFontSize) => {
    const borderRight = parseBorder(value, emBase, rootFontSize);
    if (borderRight) result.borderRight = borderRight;
  },
  'border-bottom': (result, value, emBase, rootFontSize) => {
    const borderBottom = parseBorder(value, emBase, rootFontSize);
    if (borderBottom) result.borderBottom = borderBottom;
  },
  'border-left': (result, value, emBase, rootFontSize) => {
    const borderLeft = parseBorder(value, emBase, rootFontSize);
    if (borderLeft) result.borderLeft = borderLeft;
  },
  'background-color': (result, value) => {
    result.backgroundColor = value;
  },
  background: (result, value) => {
    const background = value.trim();
    if (background && !background.includes('url(') && !background.includes('gradient')) {
      result.backgroundColor = background.split(/\s+/)[0] ?? '';
    }
  },
  'box-sizing': (result, value) => {
    const boxSizing = value.trim().toLowerCase();
    if (boxSizing === 'border-box' || boxSizing === 'content-box') {
      result.boxSizing = boxSizing;
    }
  },
  'border-radius': (result, value, emBase, rootFontSize, viewport) => {
    if (isPercentage(value)) {
      const pct = parseFloat(value.trim());
      if (!isNaN(pct) && pct >= 0) {
        result.borderRadiusPct = pct;
        result.borderRadius = 0;
      }
      return;
    }
    // Parse length directly so we can guard the borderRadiusPct clear:
    // invalid values (e.g. "foo") must not erase an earlier valid percentage.
    const parsed = parseLength(value, emBase, rootFontSize, viewport);
    if (parsed !== undefined && parsed >= 0) {
      result.borderRadius = parsed;
      delete (result as Record<string, unknown>)['borderRadiusPct'];
    }
  },
  opacity: (result, value) => {
    const opacity = parseFloat(value.trim());
    if (!isNaN(opacity)) result.opacity = Math.max(0, Math.min(1, opacity));
  },
  transform: (result, value) => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== 'none') result.transform = trimmed;
  },
  'object-fit': (result, value) => {
    const v = value.trim().toLowerCase();
    if (v === 'fill' || v === 'contain' || v === 'cover' || v === 'scale-down') {
      result.objectFit = v;
    }
  },
};
