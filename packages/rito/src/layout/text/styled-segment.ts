import type { SourceRef } from '../../parser/xhtml/types';
import type { ComputedStyle, StyledNode, VerticalAlign } from '../../style/core/types';
import { DISPLAY_VALUES, TEXT_TRANSFORMS } from '../../style/core/types';
import type { ImageSizeMap } from '../block/types';

/** A flat text segment with a single resolved style. */
export interface StyledSegment {
  readonly text: string;
  readonly style: ComputedStyle;
  readonly href?: string;
  readonly sourceRef?: SourceRef;
  readonly sourceText?: string;
  /** Ruby annotation text (from `<rt>`) to render above the base text. */
  readonly rubyAnnotation?: string;
}

/** Type guard: returns true if the segment is an inline atom. */
export function isInlineAtom(segment: InlineSegment): segment is InlineAtomSegment {
  return 'width' in segment;
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

/** A segment that participates in inline layout — either text or an atomic unit. */
export type InlineSegment = StyledSegment | InlineAtomSegment;

/**
 * Flatten a block's StyledNode children into a linear sequence of StyledSegments.
 * Inline nesting is collapsed: <p>Hello <em>world</em></p> becomes
 * [{ text: "Hello ", style: pStyle }, { text: "world", style: emStyle }].
 *
 * Only processes text and inline children. Nested blocks are skipped
 * (they should be handled by block-level layout) unless they have
 * `display: inline-block`. Images are emitted as inline atoms.
 */
export function flattenInlineContent(
  children: readonly StyledNode[],
  imageSizes?: ImageSizeMap,
  inheritedHref?: string,
): readonly InlineSegment[] {
  const segments: InlineSegment[] = [];
  collectSegments(children, segments, imageSizes, inheritedHref);
  return segments;
}

function applyTextTransform(text: string, style: ComputedStyle): string {
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

/** Inline padding values to propagate from parent inline elements. */
interface InlinePadding {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}

function hasInlinePadding(style: ComputedStyle): boolean {
  return (
    style.paddingTop > 0 ||
    style.paddingRight > 0 ||
    style.paddingBottom > 0 ||
    style.paddingLeft > 0
  );
}

function collectSegments(
  nodes: readonly StyledNode[],
  out: InlineSegment[],
  imageSizes?: ImageSizeMap,
  inheritedHref?: string,
  inheritedBgColor?: string,
  inheritedVA?: VerticalAlign,
  inheritedPadding?: InlinePadding,
  inheritedBorderRadius?: number,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const raw = node.content ?? '';
        if (raw.length > 0) {
          // Restore non-inherited properties stripped by inheritableStyle:
          // backgroundColor from inline ancestor, verticalAlign from <sup>/<sub>/etc.
          // Also restore inline padding and borderRadius for background rendering.
          const style = patchInheritedStyle(
            node.style,
            inheritedBgColor,
            inheritedVA,
            inheritedPadding,
            inheritedBorderRadius,
          );
          const seg: StyledSegment = {
            text: applyTextTransform(raw, style),
            style,
            ...(node.sourceRef ? { sourceRef: node.sourceRef, sourceText: raw } : {}),
          };
          out.push(inheritedHref ? { ...seg, href: inheritedHref } : seg);
        }
        break;
      }
      case 'inline': {
        if (node.tag === 'ruby') {
          collectRubySegments(node, out, inheritedHref, inheritedBgColor, inheritedVA);
          break;
        }
        const href = node.href ?? inheritedHref;
        const bgColor = node.style.backgroundColor || inheritedBgColor;
        const va = node.style.verticalAlign !== 'baseline' ? node.style.verticalAlign : inheritedVA;
        const pad = hasInlinePadding(node.style)
          ? {
              paddingTop: node.style.paddingTop,
              paddingRight: node.style.paddingRight,
              paddingBottom: node.style.paddingBottom,
              paddingLeft: node.style.paddingLeft,
            }
          : inheritedPadding;
        const br = node.style.borderRadius > 0 ? node.style.borderRadius : inheritedBorderRadius;
        collectSegments(node.children, out, imageSizes, href, bgColor, va, pad, br);
        break;
      }
      case 'image': {
        let atom = createImageAtom(node, imageSizes);
        if (inheritedHref) atom = { ...atom, href: inheritedHref };
        if (inheritedVA && node.style.verticalAlign === 'baseline') {
          out.push({ ...atom, style: { ...atom.style, verticalAlign: inheritedVA } });
        } else {
          out.push(atom);
        }
        break;
      }
      case 'block':
        if (node.style.display === DISPLAY_VALUES.InlineBlock) {
          out.push(createInlineBlockAtom(node));
        }
        break;
    }
  }
}

/**
 * Extract ruby base/annotation pairs from a `<ruby>` node.
 *
 * Handles two common patterns:
 * 1. Paired: `<rb>漢</rb><rt>かん</rt><rb>字</rb><rt>じ</rt>`
 * 2. Implicit base: `漢字<rt>かんじ</rt>` (text before `<rt>` is base)
 *
 * Each pair emits a separate segment with `rubyAnnotation`, preserving
 * per-character alignment. `<rp>` content is discarded.
 */
function collectRubySegments(
  ruby: StyledNode,
  out: InlineSegment[],
  inheritedHref?: string,
  inheritedBgColor?: string,
  inheritedVA?: VerticalAlign,
): void {
  // Collect base content as properly styled segments (preserving inline
  // structure, hrefs, source refs), paired with plain-text annotation from <rt>.
  // When a base group produces multiple segments (e.g. styled children inside <rb>),
  // the annotation is attached to the first segment only.
  let pendingBaseNodes: StyledNode[] = [];

  const flushBase = (annotation: string): void => {
    if (pendingBaseNodes.length === 0) return;
    const baseSegments: InlineSegment[] = [];
    collectSegments(
      pendingBaseNodes,
      baseSegments,
      undefined,
      inheritedHref,
      inheritedBgColor,
      inheritedVA,
    );
    if (annotation) {
      for (let i = 0; i < baseSegments.length; i++) {
        const seg = baseSegments[i];
        if (seg && !isInlineAtom(seg)) {
          baseSegments[i] = { ...seg, rubyAnnotation: annotation };
        }
      }
    }
    for (const seg of baseSegments) out.push(seg);
    pendingBaseNodes = [];
  };

  for (const child of ruby.children) {
    if (child.type === 'text') {
      pendingBaseNodes.push(child);
    } else if (child.type === 'inline') {
      if (child.tag === 'rt') {
        flushBase(extractText(child));
      } else if (child.tag === 'rp') {
        // Discard — fallback parentheses for non-ruby-capable renderers
      } else if (child.tag === 'rb') {
        // Flush any preceding bare text without annotation
        flushBase('');
        // Collect <rb> children as the new pending base
        pendingBaseNodes = [...child.children];
      } else {
        pendingBaseNodes.push(child);
      }
    }
  }
  flushBase('');
}

/** Recursively extract plain text from a StyledNode tree. */
function extractText(node: StyledNode): string {
  if (node.type === 'text') return node.content ?? '';
  let result = '';
  for (const child of node.children) result += extractText(child);
  return result;
}

function patchInheritedStyle(
  style: ComputedStyle,
  bgColor?: string,
  va?: VerticalAlign,
  padding?: InlinePadding,
  borderRadius?: number,
): ComputedStyle {
  const needsBg = bgColor && !style.backgroundColor;
  const needsVA = va && style.verticalAlign === 'baseline';
  const needsPad = padding && !hasInlinePadding(style);
  const needsBR = borderRadius && borderRadius > 0 && style.borderRadius <= 0;
  if (!needsBg && !needsVA && !needsPad && !needsBR) return style;
  return {
    ...style,
    ...(needsBg ? { backgroundColor: bgColor } : {}),
    ...(needsVA ? { verticalAlign: va } : {}),
    ...(needsPad ? padding : {}),
    ...(needsBR ? { borderRadius } : {}),
  };
}

function createImageAtom(node: StyledNode, imageSizes?: ImageSizeMap): InlineAtomSegment {
  const src = node.src ?? '';
  const intrinsic = imageSizes?.getSize(src);
  const fontSize = node.style.fontSize;
  let width = node.style.width > 0 ? node.style.width : (intrinsic?.width ?? fontSize);
  let height = node.style.height > 0 ? node.style.height : (intrinsic?.height ?? fontSize);

  if (!intrinsic && node.style.width <= 0 && node.style.height <= 0) {
    width = fontSize;
    height = fontSize;
  } else if (intrinsic && node.style.width <= 0 && node.style.height <= 0) {
    const lineH = node.style.lineHeightPx ?? fontSize * node.style.lineHeight;
    if (height > lineH) {
      const scale = lineH / height;
      width = width * scale;
      height = lineH;
    }
  }

  // Apply object-fit: contain — preserve intrinsic ratio within the CSS box
  if (intrinsic && node.style.objectFit === 'contain' && width > 0 && height > 0) {
    const intrinsicRatio = intrinsic.width / intrinsic.height;
    const boxRatio = width / height;
    if (intrinsicRatio < boxRatio) width = height * intrinsicRatio;
    else if (intrinsicRatio > boxRatio) height = width / intrinsicRatio;
  }

  const atom: InlineAtomSegment = {
    type: 'inline-atom',
    width,
    height,
    style: node.style,
    imageSrc: src,
  };
  return node.alt ? { ...atom, alt: node.alt } : atom;
}

function createInlineBlockAtom(node: StyledNode): InlineAtomSegment {
  const fontSize = node.style.fontSize;
  // Fallback width: 5em heuristic — inline-block children are not yet fully laid
  // out at segment collection time, so we approximate with a generous default.
  const width = node.style.width > 0 ? node.style.width : fontSize * 5;
  const height =
    node.style.height > 0
      ? node.style.height
      : (node.style.lineHeightPx ?? fontSize * node.style.lineHeight);
  return { type: 'inline-atom', width, height, style: node.style, sourceNode: node };
}
