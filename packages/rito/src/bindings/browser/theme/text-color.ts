import { CSS_NAMED_COLORS } from './css-named-colors';

// Decode finalized paint/theme colors for runtime contrast policy. CSS cascade
// parsing remains outside the Canvas renderer.

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s / 100));
  const lit = Math.max(0, Math.min(1, l / 100));

  const chroma = (1 - Math.abs(2 * lit - 1)) * sat;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lit - chroma / 2;

  let red: number;
  let green: number;
  let blue: number;
  if (hue < 60) {
    [red, green, blue] = [chroma, second, 0];
  } else if (hue < 120) {
    [red, green, blue] = [second, chroma, 0];
  } else if (hue < 180) {
    [red, green, blue] = [0, chroma, second];
  } else if (hue < 240) {
    [red, green, blue] = [0, second, chroma];
  } else if (hue < 300) {
    [red, green, blue] = [second, 0, chroma];
  } else {
    [red, green, blue] = [chroma, 0, second];
  }

  return [
    Math.round((red + match) * 255),
    Math.round((green + match) * 255),
    Math.round((blue + match) * 255),
  ];
}

function parseFunctionArgs(args: string): number[] | undefined {
  const trimmed = args.trim();
  if (trimmed.length === 0) return undefined;

  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim().replace('%', ''));
    const numbers = parts.map(Number);
    if (numbers.some(isNaN)) return undefined;
    return numbers;
  }

  const withoutSlash = trimmed.replace(/\s*\/\s*[\d.]+\s*$/, '');
  const parts = withoutSlash.split(/\s+/).map((part) => part.trim().replace('%', ''));
  const numbers = parts.map(Number);
  if (numbers.some(isNaN)) return undefined;
  return numbers;
}

function parseHex(hex: string): [number, number, number] | undefined {
  if (hex.length === 4) {
    const first = hex.charAt(1);
    const second = hex.charAt(2);
    const third = hex.charAt(3);
    const red = Number.parseInt(first + first, 16);
    const green = Number.parseInt(second + second, 16);
    const blue = Number.parseInt(third + third, 16);
    if (!isNaN(red) && !isNaN(green) && !isNaN(blue)) return [red, green, blue];
  }
  if (hex.length === 7) {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    if (!isNaN(red) && !isNaN(green) && !isNaN(blue)) return [red, green, blue];
  }
  return undefined;
}

function parseRgbFunction(argsString: string): [number, number, number] | undefined {
  const args = parseFunctionArgs(argsString);
  if (!args || args.length < 3) return undefined;
  const red = args[0] as number;
  const green = args[1] as number;
  const blue = args[2] as number;
  if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) {
    return undefined;
  }
  return [Math.round(red), Math.round(green), Math.round(blue)];
}

function parseColor(color: string): [number, number, number] | undefined {
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

function relativeLuminance(red: number, green: number, blue: number): number {
  const [rs, gs, bs] = [red / 255, green / 255, blue / 255].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  ) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
): number {
  const first = relativeLuminance(...foreground);
  const second = relativeLuminance(...background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_NORMAL_TEXT_THRESHOLD = 4.5;
const WCAG_LARGE_TEXT_THRESHOLD = 3;

export function resolveTextColor(
  originalColor: string,
  backgroundColor: string,
  foregroundColor: string,
  minContrast?: number,
  isLargeText = false,
): string {
  const foreground = parseColor(originalColor);
  const background = parseColor(backgroundColor);
  if (!foreground || !background) return originalColor;

  const threshold =
    minContrast ?? (isLargeText ? WCAG_LARGE_TEXT_THRESHOLD : WCAG_NORMAL_TEXT_THRESHOLD);
  const ratio = contrastRatio(foreground, background);
  return ratio >= threshold ? originalColor : foregroundColor;
}
