import type { ComputedStyle, StyledNode, VerticalAlign } from '../../style/core/types';
import { TEXT_TRANSFORMS } from '../../style/core/types';
import type { ImageSizeMap } from '../block/types';

interface InlinePadding {
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
}

interface InlineBorders {
  readonly borderTop: ComputedStyle['borderTop'];
  readonly borderRight: ComputedStyle['borderRight'];
  readonly borderBottom: ComputedStyle['borderBottom'];
  readonly borderLeft: ComputedStyle['borderLeft'];
}

export interface SegmentCollectionContext {
  readonly imageSizes?: ImageSizeMap | undefined;
  readonly href?: string | undefined;
  readonly bgColor?: string | undefined;
  readonly verticalAlign?: VerticalAlign | undefined;
  readonly padding?: InlinePadding | undefined;
  readonly borderRadius?: number | undefined;
  readonly borders?: InlineBorders | undefined;
}

export interface InlineChildContext {
  readonly context: SegmentCollectionContext;
  readonly hasOwnBorders: boolean;
}

export function buildInlineChildContext(
  node: StyledNode,
  inherited: SegmentCollectionContext,
): InlineChildContext {
  const hasOwnBorders = hasInlineBorders(node.style);
  return {
    hasOwnBorders,
    context: {
      imageSizes: inherited.imageSizes,
      href: node.href ?? inherited.href,
      bgColor: node.style.backgroundColor || inherited.bgColor,
      verticalAlign:
        node.style.verticalAlign !== 'baseline'
          ? node.style.verticalAlign
          : inherited.verticalAlign,
      padding: hasInlinePadding(node.style) ? paddingFromStyle(node.style) : inherited.padding,
      borderRadius: node.style.borderRadius > 0 ? node.style.borderRadius : inherited.borderRadius,
      borders: hasOwnBorders
        ? mergeBorders(inherited.borders, bordersFromStyle(node.style))
        : inherited.borders,
    },
  };
}

export function patchInheritedStyle(
  style: ComputedStyle,
  context: SegmentCollectionContext,
): ComputedStyle {
  const needsBg = context.bgColor && !style.backgroundColor;
  const needsVA = context.verticalAlign && style.verticalAlign === 'baseline';
  const needsPad = context.padding && !hasInlinePadding(style);
  const needsBR = context.borderRadius && context.borderRadius > 0 && style.borderRadius <= 0;
  const needsBorders = context.borders !== undefined;
  if (!needsBg && !needsVA && !needsPad && !needsBR && !needsBorders) return style;
  return {
    ...style,
    ...(needsBg ? { backgroundColor: context.bgColor } : {}),
    ...(needsVA ? { verticalAlign: context.verticalAlign } : {}),
    ...(needsPad ? context.padding : {}),
    ...(needsBR ? { borderRadius: context.borderRadius } : {}),
    ...(needsBorders ? mergeInheritedBorders(style, context.borders) : {}),
  };
}

export function applyTextTransform(text: string, style: ComputedStyle): string {
  switch (style.textTransform) {
    case TEXT_TRANSFORMS.Uppercase:
      return text.toUpperCase();
    case TEXT_TRANSFORMS.Lowercase:
      return text.toLowerCase();
    case TEXT_TRANSFORMS.Capitalize:
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    case TEXT_TRANSFORMS.None:
      return text;
  }
}

function hasInlinePadding(style: ComputedStyle): boolean {
  return (
    style.paddingTop > 0 ||
    style.paddingRight > 0 ||
    style.paddingBottom > 0 ||
    style.paddingLeft > 0
  );
}

function paddingFromStyle(style: ComputedStyle): InlinePadding {
  return {
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
  };
}

function hasInlineBorders(style: ComputedStyle): boolean {
  return (
    style.borderTop.width > 0 ||
    style.borderRight.width > 0 ||
    style.borderBottom.width > 0 ||
    style.borderLeft.width > 0
  );
}

function bordersFromStyle(style: ComputedStyle): InlineBorders {
  return {
    borderTop: style.borderTop,
    borderRight: style.borderRight,
    borderBottom: style.borderBottom,
    borderLeft: style.borderLeft,
  };
}

function mergeBorders(parent: InlineBorders | undefined, child: InlineBorders): InlineBorders {
  if (!parent) return child;
  return {
    borderTop: child.borderTop.width > 0 ? child.borderTop : parent.borderTop,
    borderRight: child.borderRight.width > 0 ? child.borderRight : parent.borderRight,
    borderBottom: child.borderBottom.width > 0 ? child.borderBottom : parent.borderBottom,
    borderLeft: child.borderLeft.width > 0 ? child.borderLeft : parent.borderLeft,
  };
}

function mergeInheritedBorders(
  style: ComputedStyle,
  borders: InlineBorders | undefined,
): InlineBorders {
  if (!borders) return bordersFromStyle(style);
  return {
    borderTop: style.borderTop.width > 0 ? style.borderTop : borders.borderTop,
    borderRight: style.borderRight.width > 0 ? style.borderRight : borders.borderRight,
    borderBottom: style.borderBottom.width > 0 ? style.borderBottom : borders.borderBottom,
    borderLeft: style.borderLeft.width > 0 ? style.borderLeft : borders.borderLeft,
  };
}
