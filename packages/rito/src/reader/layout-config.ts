import type { LayoutConfig, LayoutConfigInput } from './model';
export function createLayoutConfig(input: LayoutConfigInput): LayoutConfig {
  const { top, right, bottom, left } = resolveMargins(input.margin);
  const gap = input.spreadGap ?? 0;
  const requestedMode = input.spread ?? 'single';
  const effectiveMode = input.width < input.height ? 'single' : requestedMode;
  const pageWidth = effectiveMode === 'double' ? (input.width - gap) / 2 : input.width;
  return {
    viewportWidth: input.width,
    viewportHeight: input.height,
    pageWidth,
    pageHeight: input.height,
    marginTop: top,
    marginRight: right,
    marginBottom: bottom,
    marginLeft: left,
    spreadMode: effectiveMode,
    firstPageAlone: input.firstPageAlone ?? true,
    spreadGap: gap,
    rootFontSize: input.rootFontSize ?? 16,
    ...(input.lineHeightOverride !== undefined
      ? { lineHeightOverride: input.lineHeightOverride }
      : {}),
    ...(input.lineHeightForce !== undefined ? { lineHeightForce: input.lineHeightForce } : {}),
    ...(input.fontFamilyOverride !== undefined
      ? { fontFamilyOverride: input.fontFamilyOverride }
      : {}),
    ...(input.fontFamilyForce !== undefined ? { fontFamilyForce: input.fontFamilyForce } : {}),
    ...(input.paginationPolicy !== undefined ? { paginationPolicy: input.paginationPolicy } : {}),
  };
}
function resolveMargins(margin: LayoutConfigInput['margin']): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
} {
  if (margin === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof margin === 'number') {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }
  if ('x' in margin) {
    return { top: margin.y, right: margin.x, bottom: margin.y, left: margin.x };
  }
  return margin;
}
