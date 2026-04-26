import type { ComputedStyle } from '../core/types';
import { BOX_SIZING_VALUES, OBJECT_FIT_VALUES } from '../core/types';

const IMAGE_DEFAULTS: Partial<ComputedStyle> = {
  objectFit: OBJECT_FIT_VALUES.Contain,
  boxSizing: BOX_SIZING_VALUES.BorderBox,
};

export function applyRuntimeElementDefaults(style: ComputedStyle, tagName: string): ComputedStyle {
  if (tagName !== 'img') return style;
  return { ...style, ...IMAGE_DEFAULTS };
}
