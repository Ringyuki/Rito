import type { MutableStylePatch } from '../../core/style-patch';
import type { Viewport } from '../parse-utils';

export type PropertyHandler = (
  result: MutableStylePatch,
  value: string,
  emBase: number,
  rootFontSize: number,
  viewport?: Viewport,
) => void;

export type PropertyHandlers = Readonly<Record<string, PropertyHandler>>;
