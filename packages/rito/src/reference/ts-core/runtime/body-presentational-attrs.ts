import type { ElementAttributes } from '../parser/xhtml/types';
import type { ComputedStyle } from '../style/core/types';

export function applyBodyPresentationalAttrs(
  style: ComputedStyle,
  attrs: ElementAttributes,
): ComputedStyle {
  const bgcolor = readRawAttr(attrs, 'bgcolor');
  return bgcolor ? { ...style, backgroundColor: bgcolor } : style;
}

function readRawAttr(attrs: ElementAttributes, name: string): string | undefined {
  const raw = attrs.allAttributes;
  if (!raw) return undefined;
  for (const [key, value] of raw) {
    if (key.toLowerCase() === name && value.trim().length > 0) return value;
  }
  return undefined;
}
