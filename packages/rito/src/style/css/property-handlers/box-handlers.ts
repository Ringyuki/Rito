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
    const bg = value.trim();
    // `background` is a resetting shorthand — set all subproperties to CSS
    // defaults. We must assign (not delete) so the keys survive object spread
    // and override any values from earlier cascade rules.
    result.backgroundColor = '';
    result.backgroundSize = 'auto';
    result.backgroundRepeat = 'repeat';
    result.backgroundPosition = '0% 0%';
    // backgroundImage needs the Record cast for exactOptionalPropertyTypes
    (result as Record<string, unknown>)['backgroundImage'] = undefined;

    if (bg.includes('gradient')) return;

    // Extract url()
    const urlMatch = /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (urlMatch?.[1]) result.backgroundImage = urlMatch[1];
    // Strip url(...) and parse remaining tokens for color, repeat, position, size
    const rest = bg.replace(/url\(["']?[^"')]*["']?\)/g, '').trim();
    // Split on whitespace but expand `position/size` shorthand (e.g. "center/cover")
    const rawTokens = rest.split(/\s+/).filter((t) => t.length > 0);
    const tokens: string[] = [];
    for (const t of rawTokens) {
      if (t.includes('/')) {
        for (const part of t.split('/')) {
          if (part.length > 0) tokens.push(part);
        }
      } else {
        tokens.push(t);
      }
    }
    const BG_KEYWORDS = new Set([
      'no-repeat',
      'repeat',
      'repeat-x',
      'repeat-y',
      'cover',
      'contain',
      'auto',
      'center',
      'top',
      'bottom',
      'left',
      'right',
    ]);
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (lower === 'no-repeat') result.backgroundRepeat = 'no-repeat';
      else if (lower === 'repeat') result.backgroundRepeat = 'repeat';
      else if (lower === 'cover') result.backgroundSize = 'cover';
      else if (lower === 'contain') result.backgroundSize = 'contain';
      else if (
        lower === 'center' ||
        lower === 'top' ||
        lower === 'bottom' ||
        lower === 'left' ||
        lower === 'right'
      ) {
        result.backgroundPosition = result.backgroundPosition
          ? `${result.backgroundPosition} ${lower}`
          : lower;
      } else if (!BG_KEYWORDS.has(lower)) {
        // Anything not a keyword is treated as a color value
        result.backgroundColor = token;
      }
    }
  },
  'background-image': (result, value) => {
    const v = value.trim();
    if (v === 'none') {
      (result as Record<string, unknown>)['backgroundImage'] = undefined;
      return;
    }
    const urlMatch = /url\(["']?([^"')]+)["']?\)/.exec(v);
    if (urlMatch?.[1]) result.backgroundImage = urlMatch[1];
  },
  'background-size': (result, value) => {
    const v = value.trim().toLowerCase();
    if (v === 'cover' || v === 'contain' || v === 'auto') result.backgroundSize = v;
  },
  'background-repeat': (result, value) => {
    const v = value.trim().toLowerCase();
    if (v === 'no-repeat') result.backgroundRepeat = 'no-repeat';
    else if (v === 'repeat') result.backgroundRepeat = 'repeat';
  },
  'background-position': (result, value) => {
    const v = value.trim().toLowerCase();
    if (v) result.backgroundPosition = v;
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
