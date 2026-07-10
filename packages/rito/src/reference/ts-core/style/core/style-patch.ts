import type { ComputedStyle } from './types';

export type MutableStylePatch = {
  -readonly [K in keyof ComputedStyle]?: ComputedStyle[K];
};
