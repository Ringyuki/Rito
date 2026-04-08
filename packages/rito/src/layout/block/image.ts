import type { ComputedStyle } from '../../style/core/types';
import type { ImageElement, LayoutBlock } from '../core/types';
import type { ImageSizeMap } from './types';

const DEFAULT_IMAGE_ASPECT = 0.75;

export function layoutImageBlock(
  src: string,
  contentWidth: number,
  contentHeight: number,
  y: number,
  imageSizes?: ImageSizeMap,
  style?: ComputedStyle,
  alt?: string,
): LayoutBlock {
  const intrinsic = imageSizes?.getSize(src);
  const aspect = intrinsic ? intrinsic.height / intrinsic.width : DEFAULT_IMAGE_ASPECT;

  let width = style?.width && style.width > 0 ? Math.min(style.width, contentWidth) : contentWidth;
  if (style?.maxWidth && style.maxWidth > 0) width = Math.min(width, style.maxWidth);
  let height = style?.height && style.height > 0 ? style.height : width * aspect;

  // Apply object-fit: contain — preserve intrinsic ratio within the CSS box
  if (intrinsic && style?.objectFit === 'contain' && style.width > 0 && style.height > 0) {
    const intrinsicRatio = intrinsic.width / intrinsic.height;
    const boxRatio = width / height;
    if (intrinsicRatio < boxRatio) width = height * intrinsicRatio;
    else if (intrinsicRatio > boxRatio) height = width / intrinsicRatio;
  }

  if (height > contentHeight) {
    height = contentHeight;
    width = height / aspect;
  }
  if (width > contentWidth) {
    width = contentWidth;
    height = width * aspect;
  }

  const x = width < contentWidth ? (contentWidth - width) / 2 : 0;
  const base: ImageElement = { type: 'image', src, bounds: { x, y: 0, width, height } };
  const imageElement: ImageElement = alt ? { ...base, alt } : base;
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children: [imageElement],
  };
}
