export function canvasSpacingValue(value: number | undefined): string {
  return value === undefined ? '0px' : `${String(value)}px`;
}
