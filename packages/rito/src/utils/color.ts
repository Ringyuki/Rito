// WCAG contrast ratio utilities for theme-aware text color selection.

import { CSS_NAMED_COLORS } from './css-named-colors';

/** Convert a single HSL channel set to RGB. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  // Normalize h to [0, 360), s and l to [0, 1]
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s / 100));
  const lit = Math.max(0, Math.min(1, l / 100));

  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;

  let r1: number;
  let g1: number;
  let b1: number;

  if (hue < 60) {
    [r1, g1, b1] = [c, x, 0];
  } else if (hue < 120) {
    [r1, g1, b1] = [x, c, 0];
  } else if (hue < 180) {
    [r1, g1, b1] = [0, c, x];
  } else if (hue < 240) {
    [r1, g1, b1] = [0, x, c];
  } else if (hue < 300) {
    [r1, g1, b1] = [x, 0, c];
  } else {
    [r1, g1, b1] = [c, 0, x];
  }

  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/**
 * Parse comma-separated or space-separated numeric values from a
 * CSS function argument string. Returns undefined on failure.
 */
function parseFunctionArgs(args: string): number[] | undefined {
  const trimmed = args.trim();
  if (trimmed.length === 0) return undefined;

  // Try comma-separated first
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((p) => p.trim().replace('%', ''));
    const nums = parts.map(Number);
    if (nums.some(isNaN)) return undefined;
    return nums;
  }

  // Space-separated (CSS Color Level 4 syntax), possibly with / for alpha
  const withoutSlash = trimmed.replace(/\s*\/\s*[\d.]+\s*$/, '');
  const parts = withoutSlash.split(/\s+/).map((p) => p.trim().replace('%', ''));
  const nums = parts.map(Number);
  if (nums.some(isNaN)) return undefined;
  return nums;
}

/** Parse a hex color (#rgb or #rrggbb) to [r, g, b]. */
function parseHex(hex: string): [number, number, number] | undefined {
  if (hex.length === 4) {
    const c1 = hex.charAt(1);
    const c2 = hex.charAt(2);
    const c3 = hex.charAt(3);
    const r = parseInt(c1 + c1, 16);
    const g = parseInt(c2 + c2, 16);
    const b = parseInt(c3 + c3, 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r, g, b];
  }
  if (hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r, g, b];
  }
  return undefined;
}

/** Parse rgb()/rgba() arguments to [r, g, b]. */
function parseRgbFunction(argsStr: string): [number, number, number] | undefined {
  const args = parseFunctionArgs(argsStr);
  if (!args || args.length < 3) return undefined;
  const r = args[0] as number;
  const g = args[1] as number;
  const b = args[2] as number;
  if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return undefined;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** Parse a CSS color string to [r, g, b] in 0-255 range. */
export function parseColor(color: string): [number, number, number] | undefined {
  const trimmed = color.trim();
  if (trimmed.length === 0) return undefined;

  if (trimmed.startsWith('#')) return parseHex(trimmed);

  const rgbMatch = /^rgba?\(\s*(.+)\s*\)$/i.exec(trimmed);
  if (rgbMatch?.[1]) return parseRgbFunction(rgbMatch[1]);

  const hslMatch = /^hsla?\(\s*(.+)\s*\)$/i.exec(trimmed);
  if (hslMatch?.[1]) {
    const args = parseFunctionArgs(hslMatch[1]);
    if (!args || args.length < 3) return undefined;
    return hslToRgb(args[0] as number, args[1] as number, args[2] as number);
  }

  return CSS_NAMED_COLORS[trimmed.toLowerCase()];
}

/** Compute WCAG 2.1 relative luminance of an sRGB color. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  ) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Compute WCAG contrast ratio between two colors (1:1 to 21:1). */
export function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(...fg);
  const l2 = relativeLuminance(...bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA contrast threshold for normal text. */
const WCAG_NORMAL_TEXT_THRESHOLD = 4.5;

/** WCAG AA contrast threshold for large text. */
const WCAG_LARGE_TEXT_THRESHOLD = 3;

/**
 * Determine the effective text color for rendering.
 *
 * If the original text color has insufficient contrast against the background,
 * returns the override foreground color. Otherwise returns the original.
 *
 * @param isLargeText - When true, uses WCAG AA large-text threshold (3:1);
 *   when false (default), uses normal-text threshold (4.5:1).
 *   The `minContrast` parameter, if provided, takes precedence.
 */
export function resolveTextColor(
  originalColor: string,
  backgroundColor: string,
  foregroundColor: string,
  minContrast?: number,
  isLargeText = false,
): string {
  const fg = parseColor(originalColor);
  const bg = parseColor(backgroundColor);
  if (!fg || !bg) return originalColor;

  const threshold =
    minContrast ?? (isLargeText ? WCAG_LARGE_TEXT_THRESHOLD : WCAG_NORMAL_TEXT_THRESHOLD);
  const ratio = contrastRatio(fg, bg);
  if (ratio >= threshold) return originalColor;
  return foregroundColor;
}
