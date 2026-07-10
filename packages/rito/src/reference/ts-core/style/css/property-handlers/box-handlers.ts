import { parseLength } from '../parse-utils';
import { parseBackgroundPosition } from '../parse-background-position';
import { parseTransform } from '../parse-transform';
import { parseBorder } from '../value-parsers';
import type { MutableStylePatch } from '../../core/style-patch';
import { isPercentage } from './helpers';
import type { PropertyHandlers } from './types';

const DEFAULT_BG_POS_AUTO = parseBackgroundPosition('0% 0%');
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
    applyBackgroundShorthand(result, value);
  },
  'background-image': (result, value) => {
    applyBackgroundImage(result, value);
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
    const parsed = parseBackgroundPosition(value);
    if (parsed) result.backgroundPosition = parsed;
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
    const fns = parseTransform(value);
    if (fns.length > 0) result.transform = fns;
  },
  'object-fit': (result, value) => {
    const v = value.trim().toLowerCase();
    if (v === 'fill' || v === 'contain' || v === 'cover' || v === 'scale-down') {
      result.objectFit = v;
    }
  },
};

function applyBackgroundShorthand(result: MutableStylePatch, value: string): void {
  const bg = value.trim();
  resetBackground(result);
  if (bg.includes('gradient')) return;

  const image = extractBackgroundUrl(bg);
  if (image) result.backgroundImage = image;

  const positionTokens = applyBackgroundTokens(result, tokenizeBackground(bg));
  if (positionTokens.length > 0) {
    const parsed = parseBackgroundPosition(positionTokens.join(' '));
    if (parsed) result.backgroundPosition = parsed;
  }
}

function resetBackground(result: MutableStylePatch): void {
  result.backgroundColor = '';
  result.backgroundSize = 'auto';
  result.backgroundRepeat = 'repeat';
  if (DEFAULT_BG_POS_AUTO) result.backgroundPosition = DEFAULT_BG_POS_AUTO;
  (result as Record<string, unknown>)['backgroundImage'] = undefined;
}

function applyBackgroundImage(result: MutableStylePatch, value: string): void {
  const v = value.trim();
  if (v === 'none') {
    (result as Record<string, unknown>)['backgroundImage'] = undefined;
    return;
  }
  const image = extractBackgroundUrl(v);
  if (image) result.backgroundImage = image;
}

function extractBackgroundUrl(value: string): string | undefined {
  const urlMatch = /url\(["']?([^"')]+)["']?\)/.exec(value);
  return urlMatch?.[1];
}

function tokenizeBackground(value: string): readonly string[] {
  const rest = value.replace(/url\(["']?[^"')]*["']?\)/g, '').trim();
  return rest
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .flatMap((token) => token.split('/').filter((part) => part.length > 0));
}

function applyBackgroundTokens(
  result: MutableStylePatch,
  tokens: readonly string[],
): readonly string[] {
  const positionTokens: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (applyBackgroundKeyword(result, lower)) continue;
    if (isBackgroundPositionKeyword(lower)) positionTokens.push(lower);
    else if (!BG_KEYWORDS.has(lower)) result.backgroundColor = token;
  }
  return positionTokens;
}

function applyBackgroundKeyword(result: MutableStylePatch, token: string): boolean {
  if (token === 'no-repeat') {
    result.backgroundRepeat = 'no-repeat';
    return true;
  }
  if (token === 'repeat') {
    result.backgroundRepeat = 'repeat';
    return true;
  }
  if (token === 'cover' || token === 'contain') {
    result.backgroundSize = token;
    return true;
  }
  return false;
}

function isBackgroundPositionKeyword(token: string): boolean {
  return (
    token === 'center' ||
    token === 'top' ||
    token === 'bottom' ||
    token === 'left' ||
    token === 'right'
  );
}
