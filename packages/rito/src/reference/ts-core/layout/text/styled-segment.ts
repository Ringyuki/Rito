import type { SourceRef } from '../../parser/xhtml/types';
import type { ComputedStyle, StyledNode } from '../../style/core/types';
import type { ImageSizeMap } from '../block/types';
import { collectSegments } from './styled-segment-collector';

/** A flat text segment with a single resolved style. */
export interface StyledSegment {
  readonly text: string;
  readonly style: ComputedStyle;
  readonly href?: string;
  readonly sourceRef?: SourceRef;
  readonly sourceText?: string;
  /** Source offset corresponding to the first code unit in `text`. */
  readonly sourceTextOffset?: number;
  /** Ruby annotation text (from `<rt>`) to render above the base text. */
  readonly rubyAnnotation?: string;
  /** Inline margin-left in px (from the inline element, not inherited). */
  readonly inlineMarginLeft?: number;
  /** Inline margin-right in px (from the inline element, not inherited). */
  readonly inlineMarginRight?: number;
  /** True if this is the first fragment of a bordered inline box. */
  readonly borderStart?: boolean;
  /** True if this is the last fragment of a bordered inline box. */
  readonly borderEnd?: boolean;
}

/** An atomic inline unit (image or inline-block) participating in text flow. */
export interface InlineAtomSegment {
  readonly type: 'inline-atom';
  readonly width: number;
  readonly height: number;
  readonly style: ComputedStyle;
  readonly imageSrc?: string;
  readonly alt?: string;
  readonly href?: string;
  readonly sourceNode?: StyledNode;
}

/** A segment that participates in inline layout - either text or an atomic unit. */
export type InlineSegment = StyledSegment | InlineAtomSegment;

/** Type guard: returns true if the segment is an inline atom. */
export function isInlineAtom(segment: InlineSegment): segment is InlineAtomSegment {
  return 'width' in segment;
}

/**
 * Flatten a block's StyledNode children into a linear sequence of StyledSegments.
 * Inline nesting is collapsed; images and inline-blocks are emitted as atoms.
 */
export function flattenInlineContent(
  children: readonly StyledNode[],
  imageSizes?: ImageSizeMap,
  inheritedHref?: string,
): readonly InlineSegment[] {
  const segments: InlineSegment[] = [];
  collectSegments(children, segments, {
    imageSizes,
    href: inheritedHref,
    whitespace: { previousEndedWithSpace: false },
  });
  return segments;
}
