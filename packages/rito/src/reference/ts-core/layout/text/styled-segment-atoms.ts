import type { StyledNode } from '../../style/core/types';
import type { ImageSizeMap } from '../block/types';
import type { InlineAtomSegment } from './styled-segment';

export function createImageAtom(node: StyledNode, imageSizes?: ImageSizeMap): InlineAtomSegment {
  const src = node.src ?? '';
  const intrinsic = imageSizes?.getSize(src);
  const fontSize = node.style.fontSize;
  let width = node.style.width > 0 ? node.style.width : (intrinsic?.width ?? fontSize);
  let height = node.style.height > 0 ? node.style.height : (intrinsic?.height ?? fontSize);

  if (!intrinsic && node.style.width <= 0 && node.style.height <= 0) {
    width = fontSize;
    height = fontSize;
  } else if (intrinsic && node.style.width <= 0 && node.style.height <= 0) {
    ({ width, height } = fitIntrinsicToLineHeight(width, height, node));
  }

  ({ width, height } = fitContainObject(width, height, intrinsic, node));
  const atom: InlineAtomSegment = {
    type: 'inline-atom',
    width,
    height,
    style: node.style,
    imageSrc: src,
  };
  return node.alt ? { ...atom, alt: node.alt } : atom;
}

export function createInlineBlockAtom(node: StyledNode): InlineAtomSegment {
  const fontSize = node.style.fontSize;
  const width = node.style.width > 0 ? node.style.width : fontSize * 5;
  const height =
    node.style.height > 0
      ? node.style.height
      : (node.style.lineHeightPx ?? fontSize * node.style.lineHeight);
  return { type: 'inline-atom', width, height, style: node.style, sourceNode: node };
}

function fitIntrinsicToLineHeight(
  width: number,
  height: number,
  node: StyledNode,
): { readonly width: number; readonly height: number } {
  const lineHeight = node.style.lineHeightPx ?? node.style.fontSize * node.style.lineHeight;
  if (height <= lineHeight) return { width, height };
  const scale = lineHeight / height;
  return { width: width * scale, height: lineHeight };
}

function fitContainObject(
  width: number,
  height: number,
  intrinsic: { readonly width: number; readonly height: number } | undefined,
  node: StyledNode,
): { readonly width: number; readonly height: number } {
  if (!intrinsic || node.style.objectFit !== 'contain' || width <= 0 || height <= 0) {
    return { width, height };
  }
  const intrinsicRatio = intrinsic.width / intrinsic.height;
  const boxRatio = width / height;
  if (intrinsicRatio < boxRatio) return { width: height * intrinsicRatio, height };
  if (intrinsicRatio > boxRatio) return { width, height: width / intrinsicRatio };
  return { width, height };
}
