import type { ComputedStyle } from '../../../style/core/types';
import type { InlineAtom } from '../../core/types';
import type { InlineAtomSegment } from '../../text/styled-segment';

export function buildAtomRun(
  atom: InlineAtomSegment,
  x: number,
  lineHeight: number,
  baseFontSize: number,
): InlineAtom {
  const base: InlineAtom = {
    type: 'inline-atom',
    bounds: {
      x,
      y: computeVerticalAlignOffset(atom.style, lineHeight, baseFontSize),
      width: atom.width,
      height: atom.height,
    },
  };
  if (atom.imageSrc === undefined) return base;

  let withSrc: InlineAtom = { ...base, imageSrc: atom.imageSrc };
  if (atom.alt) withSrc = { ...withSrc, alt: atom.alt };
  if (atom.href) withSrc = { ...withSrc, href: atom.href };
  return withSrc;
}

export function computeVerticalAlignOffset(
  style: ComputedStyle,
  lineHeight: number,
  baseFontSize: number,
): number {
  switch (style.verticalAlign) {
    case 'baseline':
      return ASCENT_RATIO * (baseFontSize - style.fontSize);
    case 'top':
    case 'text-top':
      return 0;
    case 'super':
      return -(style.fontSize * 0.4);
    case 'sub':
      return style.fontSize * 0.2;
    case 'middle':
      return (lineHeight - style.fontSize) / 2;
    case 'bottom':
    case 'text-bottom':
      return lineHeight - style.fontSize;
    default:
      return 0;
  }
}

const ASCENT_RATIO = 0.8;
