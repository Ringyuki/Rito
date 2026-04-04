import type { MutableStylePatch } from '../../core/style-patch';

export type PropertyHandler = (
  result: MutableStylePatch,
  value: string,
  emBase: number,
  rootFontSize: number,
) => void;

export type PropertyHandlers = Readonly<Record<string, PropertyHandler>>;
