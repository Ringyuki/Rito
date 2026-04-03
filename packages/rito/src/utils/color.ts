// WCAG contrast ratio utilities for theme-aware text color selection.

/** Parse a CSS color string to [r, g, b] in 0-255 range. Supports hex (#rgb, #rrggbb). */
export function parseColor(color: string): [number, number, number] | undefined {
  const hex = color.trim();
  if (hex.startsWith('#')) {
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
  }
  // Named colors — common ones
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
  };
  return named[hex.toLowerCase()];
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

/**
 * Determine the effective text color for rendering.
 *
 * If the original text color has insufficient contrast against the background,
 * returns the override foreground color. Otherwise returns the original.
 */
export function resolveTextColor(
  originalColor: string,
  backgroundColor: string,
  foregroundColor: string,
  minContrast = 3,
): string {
  const fg = parseColor(originalColor);
  const bg = parseColor(backgroundColor);
  if (!fg || !bg) return originalColor;

  const ratio = contrastRatio(fg, bg);
  if (ratio >= minContrast) return originalColor;
  return foregroundColor;
}
