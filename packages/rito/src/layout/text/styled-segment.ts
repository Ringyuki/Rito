import type { SourceRef } from '../../parser/xhtml/types';
import type { ComputedStyle, StyledNode } from '../../style/core/types';
import { DISPLAY_VALUES, TEXT_TRANSFORMS } from '../../style/core/types';
import type { ImageSizeMap } from '../block/types';

/** A flat text segment with a single resolved style. */
export interface StyledSegment {
  readonly text: string;
  readonly style: ComputedStyle;
  readonly href?: string;
  readonly sourceRef?: SourceRef;
  readonly sourceText?: string;
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

function collectSegments(
  nodes: readonly StyledNode[],
  out: InlineSegment[],
  imageSizes?: ImageSizeMap,
  inheritedHref?: string,
  inheritedBgColor?: string,
  inheritedVA?: string,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const raw = node.content ?? '';
        if (raw.length > 0) {
          // Restore non-inherited properties stripped by inheritableStyle:
          // backgroundColor from inline ancestor, verticalAlign from <sup>/<sub>/etc.
          const style = patchInheritedStyle(node.style, inheritedBgColor, inheritedVA);
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
        const href = node.href ?? inheritedHref;
        const bgColor = node.style.backgroundColor || inheritedBgColor;
        const va = node.style.verticalAlign !== 'baseline' ? node.style.verticalAlign : inheritedVA;
        collectSegments(node.children, out, imageSizes, href, bgColor, va);
        break;
      }
      case 'image': {
        const atom = createImageAtom(node, imageSizes);
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

function patchInheritedStyle(style: ComputedStyle, bgColor?: string, va?: string): ComputedStyle {
  const needsBg = bgColor && !style.backgroundColor;
  const needsVA = va && style.verticalAlign === 'baseline';
  if (!needsBg && !needsVA) return style;
  return {
    ...style,
    ...(needsBg ? { backgroundColor: bgColor } : {}),
    ...(needsVA ? { verticalAlign: va } : {}),
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
    const lineH = fontSize * node.style.lineHeight;
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
  const height = node.style.height > 0 ? node.style.height : fontSize * node.style.lineHeight;
  return { type: 'inline-atom', width, height, style: node.style, sourceNode: node };
}
