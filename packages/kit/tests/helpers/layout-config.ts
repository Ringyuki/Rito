import type { LayoutConfig } from '@ritojs/core';

/** A layout's geometry for a test: pages split evenly, as on an even viewport. */
export function createLayoutConfig(input: {
  readonly width: number;
  readonly height: number;
  readonly margin?:
    | number
    | {
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
        readonly left: number;
      };
  readonly spread?: 'single' | 'double';
  readonly spreadGap?: number;
}): LayoutConfig {
  const margin =
    typeof input.margin === 'object'
      ? input.margin
      : {
          top: input.margin ?? 0,
          right: input.margin ?? 0,
          bottom: input.margin ?? 0,
          left: input.margin ?? 0,
        };
  const gap = input.spreadGap ?? 0;
  const spreadMode = input.width < input.height ? 'single' : (input.spread ?? 'single');
  return {
    viewportWidth: input.width,
    viewportHeight: input.height,
    pageWidth: spreadMode === 'double' ? (input.width - gap) / 2 : input.width,
    pageHeight: input.height,
    marginTop: margin.top,
    marginRight: margin.right,
    marginBottom: margin.bottom,
    marginLeft: margin.left,
    spreadMode,
    firstPageAlone: true,
    spreadGap: gap,
    rootFontSize: 16,
  };
}
