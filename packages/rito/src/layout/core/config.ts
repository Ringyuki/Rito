import type { LayoutConfig, PaginationPolicy } from './types';

/** Shorthand input for creating a LayoutConfig. */
export interface LayoutConfigInput {
  /** Viewport (canvas) width in logical pixels. */
  readonly width: number;
  /** Viewport (canvas) height in logical pixels. */
  readonly height: number;
  /**
   * Page margins. Can be:
   * - A single number (uniform margins)
   * - `{ x, y }` (horizontal and vertical)
   * - `{ top, right, bottom, left }` (individual)
   */
  readonly margin?:
    | number
    | { x: number; y: number }
    | {
        top: number;
        right: number;
        bottom: number;
        left: number;
      };
  /** Display mode: 'single' or 'double' (two-page spread). Defaults to 'single'. */
  readonly spread?: 'single' | 'double';
  /** If true, the first page (cover) stands alone. Defaults to true. */
  readonly firstPageAlone?: boolean;
  /** Gap between pages in double mode, in logical pixels. Defaults to 0. */
  readonly spreadGap?: number;
  /** Root font size in px, used to resolve rem units. Defaults to 16. */
  readonly rootFontSize?: number;
  /** Global line-height multiplier override. Overrides CSS on body. */
  readonly lineHeightOverride?: number;
  /**
   * When true (and `lineHeightOverride` is set), force the override on every element,
   * bypassing element-level CSS rules like `p { line-height: 1.3em }`.
   * When false (default), the override only cascades from body and may be shadowed
   * by more specific selectors in the EPUB.
   */
  readonly lineHeightForce?: boolean;
  /** Global font-family override. Overrides CSS on body. */
  readonly fontFamilyOverride?: string;
  /**
   * When true (and `fontFamilyOverride` is set), force the override on every element,
   * bypassing element-level CSS rules like `pre { font-family: monospace }`.
   */
  readonly fontFamilyForce?: boolean;
  /** Runtime pagination policy for widow/orphan control. */
  readonly paginationPolicy?: PaginationPolicy;
}

/**
 * Create a {@link LayoutConfig} from a simplified input.
 *
 * `width` and `height` define the **viewport** (canvas) dimensions.
 * Page dimensions are derived automatically:
 * - Single mode: page fills the full viewport.
 * - Double mode: each page = `(width - gap) / 2 × height`.
 * - Portrait viewport (width < height): forces single mode regardless of config.
 *
 * @example
 * ```ts
 * // Single page, uniform margins
 * createLayoutConfig({ width: 800, height: 1200, margin: 40 })
 *
 * // Two-page spread with gap
 * createLayoutConfig({ width: 1600, height: 1200, margin: 40, spread: 'double', spreadGap: 20 })
 *
 * // Portrait viewport: double mode auto-downgrades to single
 * createLayoutConfig({ width: 600, height: 900, spread: 'double' })
 * ```
 */
export function createLayoutConfig(input: LayoutConfigInput): LayoutConfig {
  const { top, right, bottom, left } = resolveMargins(input.margin);
  const gap = input.spreadGap ?? 0;

  // Portrait viewport: force single mode
  const requestedMode = input.spread ?? 'single';
  const effectiveMode = input.width < input.height ? 'single' : requestedMode;

  const pageWidth = effectiveMode === 'double' ? (input.width - gap) / 2 : input.width;
  const pageHeight = input.height;

  return {
    viewportWidth: input.width,
    viewportHeight: input.height,
    pageWidth,
    pageHeight,
    marginTop: top,
    marginRight: right,
    marginBottom: bottom,
    marginLeft: left,
    spreadMode: effectiveMode,
    firstPageAlone: input.firstPageAlone ?? true,
    spreadGap: gap,
    rootFontSize: input.rootFontSize ?? 16,
    ...(input.lineHeightOverride !== undefined
      ? { lineHeightOverride: input.lineHeightOverride }
      : {}),
    ...(input.lineHeightForce !== undefined ? { lineHeightForce: input.lineHeightForce } : {}),
    ...(input.fontFamilyOverride !== undefined
      ? { fontFamilyOverride: input.fontFamilyOverride }
      : {}),
    ...(input.fontFamilyForce !== undefined ? { fontFamilyForce: input.fontFamilyForce } : {}),
    ...(input.paginationPolicy !== undefined ? { paginationPolicy: input.paginationPolicy } : {}),
  };
}

function resolveMargins(margin: LayoutConfigInput['margin']): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  if (margin === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof margin === 'number') {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }
  if ('x' in margin) {
    return { top: margin.y, right: margin.x, bottom: margin.y, left: margin.x };
  }
  return margin;
}
