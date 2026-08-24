import type { BackgroundPosition, LengthPct } from '../core/paint-types';

/** Per-axis keyword → percentage. `center` works on either axis. */
const H_KEYWORD: Record<string, number> = { left: 0, center: 50, right: 100 };
const V_KEYWORD: Record<string, number> = { top: 0, center: 50, bottom: 100 };

/**
 * Parse a CSS `background-position` value into a structured BackgroundPosition.
 *
 * Supports 1–2 tokens separated by whitespace. Each token is a keyword
 * (left/center/right for X, top/center/bottom for Y) or a length (`px`/`%`).
 *
 * When only one token is given, the missing axis defaults to `center` (50%).
 * When tokens disagree on axis (e.g. `top 20px` with vertical keyword first),
 * we accept the order implicitly — callers overwhelmingly write H then V.
 *
 * Returns `undefined` on unparseable input; consumers then fall back to
 * `backgroundSize`-dependent defaults (`0% 0%` for `auto`, `50% 50%` for
 * `cover` / `contain`).
 */
export function parseBackgroundPosition(input: string): BackgroundPosition | undefined {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return undefined;

  if (tokens.length === 1) {
    const only = tokens[0] ?? '';
    return singleTokenPosition(only);
  }

  // Two tokens: first → X, second → Y. When the first is an unambiguous
  // vertical-only keyword (top/bottom) and the second is horizontal, swap.
  const first = tokens[0] ?? '';
  const second = tokens[1] ?? '';
  if (isVerticalOnly(first) && isHorizontalOnly(second)) {
    const x = toLengthPct(second, H_KEYWORD);
    const y = toLengthPct(first, V_KEYWORD);
    if (!x || !y) return undefined;
    return { x, y };
  }
  const x = toLengthPct(first, H_KEYWORD);
  const y = toLengthPct(second, V_KEYWORD);
  if (!x || !y) return undefined;
  return { x, y };
}

function singleTokenPosition(token: string): BackgroundPosition | undefined {
  // 'center' — both axes 50%
  if (token === 'center') {
    return { x: pct(50), y: pct(50) };
  }
  if (isHorizontalOnly(token)) {
    const x = toLengthPct(token, H_KEYWORD);
    return x ? { x, y: pct(50) } : undefined;
  }
  if (isVerticalOnly(token)) {
    const y = toLengthPct(token, V_KEYWORD);
    return y ? { x: pct(50), y } : undefined;
  }
  // Numeric length/percent on X, center on Y.
  const v = parseLengthPct(token);
  return v ? { x: v, y: pct(50) } : undefined;
}

function isHorizontalOnly(token: string): boolean {
  return token === 'left' || token === 'right';
}

function isVerticalOnly(token: string): boolean {
  return token === 'top' || token === 'bottom';
}

function toLengthPct(token: string, keywords: Record<string, number>): LengthPct | undefined {
  if (token in keywords) return pct(keywords[token] ?? 0);
  return parseLengthPct(token);
}

function parseLengthPct(token: string): LengthPct | undefined {
  const n = parseFloat(token);
  if (isNaN(n)) return undefined;
  if (token.endsWith('%')) return { unit: 'percent', value: n };
  // Bare number or explicit px
  return { unit: 'px', value: n };
}

function pct(value: number): LengthPct {
  return { unit: 'percent', value };
}
