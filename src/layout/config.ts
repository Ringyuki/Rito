import type { LayoutConfig } from './types';

/** Shorthand input for creating a LayoutConfig. */
export interface LayoutConfigInput {
  /** Page width in logical pixels. */
  readonly width: number;
  /** Page height in logical pixels. */
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
  /** Gap between pages in double mode. Defaults to 0. */
  readonly spreadGap?: number;
}

/**
 * Create a {@link LayoutConfig} from a simplified input.
 *
 * @example
 * ```ts
 * // Uniform 40px margins
 * createLayoutConfig({ width: 800, height: 1200, margin: 40 })
 *
 * // Horizontal/vertical margins
 * createLayoutConfig({ width: 800, height: 1200, margin: { x: 40, y: 60 } })
 *
 * // Individual margins
 * createLayoutConfig({ width: 800, height: 1200, margin: { top: 60, right: 40, bottom: 60, left: 40 } })
 *
 * // No margins
 * createLayoutConfig({ width: 800, height: 1200 })
 * ```
 */
export function createLayoutConfig(input: LayoutConfigInput): LayoutConfig {
  const { top, right, bottom, left } = resolveMargins(input.margin);
  return {
    pageWidth: input.width,
    pageHeight: input.height,
    marginTop: top,
    marginRight: right,
    marginBottom: bottom,
    marginLeft: left,
    spreadMode: input.spread ?? 'single',
    firstPageAlone: input.firstPageAlone ?? true,
    spreadGap: input.spreadGap ?? 0,
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
