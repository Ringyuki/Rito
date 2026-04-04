import type { ComputedStyle } from '../../style/types';
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
): LayoutBlock {
  const intrinsic = imageSizes?.getSize(src);
  const aspect = intrinsic ? intrinsic.height / intrinsic.width : DEFAULT_IMAGE_ASPECT;

  let width = style?.width && style.width > 0 ? Math.min(style.width, contentWidth) : contentWidth;
  if (style?.maxWidth && style.maxWidth > 0) width = Math.min(width, style.maxWidth);
  let height = style?.height && style.height > 0 ? style.height : width * aspect;

  if (height > contentHeight) {
    height = contentHeight;
    width = height / aspect;
  }
  if (width > contentWidth) {
    width = contentWidth;
    height = width * aspect;
  }

  const x = width < contentWidth ? (contentWidth - width) / 2 : 0;
  const imageElement: ImageElement = {
    type: 'image',
    src,
    bounds: { x, y: 0, width, height },
  };
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children: [imageElement],
  };
}
