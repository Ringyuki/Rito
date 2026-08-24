import type { ComputedStyle } from '../../style/core/types';
import type { ImageElement, LayoutBlock } from '../core/types';
import type { ImageSizeMap } from './types';

const DEFAULT_IMAGE_ASPECT = 0.75;

interface ImageIntrinsicSize {
  readonly width: number;
  readonly height: number;
}

interface ImageBox {
  readonly width: number;
  readonly height: number;
}

export function layoutImageBlock(
  src: string,
  contentWidth: number,
  contentHeight: number,
  y: number,
  imageSizes?: ImageSizeMap,
  style?: ComputedStyle,
  alt?: string,
  href?: string,
): LayoutBlock {
  const intrinsic = imageSizes?.getSize(src);
  const aspect = intrinsic ? intrinsic.height / intrinsic.width : DEFAULT_IMAGE_ASPECT;
  const { width, height } = resolveImageBox(contentWidth, contentHeight, aspect, intrinsic, style);
  const x = width < contentWidth ? (contentWidth - width) / 2 : 0;
  const base: ImageElement = { type: 'image', src, bounds: { x, y: 0, width, height } };
  const imageElement = withImageMetadata(base, alt, href);

  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children: [imageElement],
  };
}

function resolveImageBox(
  contentWidth: number,
  contentHeight: number,
  aspect: number,
  intrinsic: ImageIntrinsicSize | undefined,
  style: ComputedStyle | undefined,
): ImageBox {
  const hasExplicitWidth = style?.width !== undefined && style.width > 0;
  const hasExplicitHeight = style?.height !== undefined && style.height > 0;
  let width = hasExplicitWidth ? Math.min(style.width, contentWidth) : contentWidth;
  if (style?.maxWidth && style.maxWidth > 0) width = Math.min(width, style.maxWidth);
  let height = hasExplicitHeight ? style.height : width * aspect;

  // When only height is set, derive width from intrinsic aspect ratio
  if (hasExplicitHeight && !hasExplicitWidth) {
    width = Math.min(height / aspect, contentWidth);
  }

  ({ width, height } = fitContainBox({ width, height }, intrinsic, style));

  if (height > contentHeight) {
    height = contentHeight;
    width = height / aspect;
  }
  if (width > contentWidth) {
    width = contentWidth;
    height = width * aspect;
  }

  return { width, height };
}

function fitContainBox(
  box: ImageBox,
  intrinsic: ImageIntrinsicSize | undefined,
  style: ComputedStyle | undefined,
): ImageBox {
  if (!intrinsic || style?.objectFit !== 'contain' || style.width <= 0 || style.height <= 0) {
    return box;
  }

  const intrinsicRatio = intrinsic.width / intrinsic.height;
  const boxRatio = box.width / box.height;
  if (intrinsicRatio < boxRatio) return { ...box, width: box.height * intrinsicRatio };
  if (intrinsicRatio > boxRatio) return { ...box, height: box.width / intrinsicRatio };
  return box;
}

function withImageMetadata(
  base: ImageElement,
  alt: string | undefined,
  href: string | undefined,
): ImageElement {
  let imageElement: ImageElement = alt ? { ...base, alt } : base;
  if (href) imageElement = { ...imageElement, href };
  return imageElement;
}
