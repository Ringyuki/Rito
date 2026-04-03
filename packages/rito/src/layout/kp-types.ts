/**
 * Types for the Knuth-Plass optimal line-breaking algorithm.
 *
 * The algorithm models paragraph content as a sequence of three item types:
 * - Box: fixed-width content (words, inline elements)
 * - Glue: stretchable/shrinkable space between boxes
 * - Penalty: a possible break point with an associated cost
 */

import type { StyledSegment } from './styled-segment';

/** Fixed-width content item (a word or inline element). */
export interface KPBox {
  readonly type: 'box';
  /** Natural width of the content in pixels. */
  readonly width: number;
  /** The text content of this box. */
  readonly text: string;
  /** Reference to the original styled segment. */
  readonly segment: StyledSegment;
}

/** Stretchable/shrinkable space (typically between words). */
export interface KPGlue {
  readonly type: 'glue';
  /** Natural (ideal) width of the space. */
  readonly width: number;
  /** Maximum additional stretch (positive). */
  readonly stretch: number;
  /** Maximum shrink (positive value; actual shrink subtracts from width). */
  readonly shrink: number;
}

/** A possible break point with an associated penalty cost. */
export interface KPPenalty {
  readonly type: 'penalty';
  /** Extra width added if a break occurs here (e.g., hyphen width). */
  readonly width: number;
  /** Cost of breaking here. -Infinity = forced break, +Infinity = forbidden. */
  readonly penalty: number;
  /** True if this is a hyphenation break (used for consecutive-hyphen demerits). */
  readonly flagged: boolean;
}

/** Union of all item types in the KP item list. */
export type KPItem = KPBox | KPGlue | KPPenalty;

/** A chosen breakpoint in the optimal solution. */
export interface KPBreakpoint {
  /** Index into the KPItem[] array where this break occurs. */
  readonly position: number;
  /** Accumulated demerits up to this breakpoint. */
  readonly demerits: number;
  /** Adjustment ratio for the line ending at this breakpoint. */
  readonly ratio: number;
  /** The line number (0-based) ending at this breakpoint. */
  readonly line: number;
  /** Previous breakpoint in the chain (undefined for the initial node). */
  readonly prev: KPBreakpoint | undefined;
}
