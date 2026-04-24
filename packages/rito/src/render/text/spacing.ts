export function canvasSpacingValue(value: number | undefined): string {
  return value === undefined ? '0px' : `${String(value)}px`;
}

export function textSpacingAdvance(
  text: string,
  wordSpacingPx: number,
  letterSpacingPx: number,
): number {
  return countAsciiSpaces(text) * wordSpacingPx + countLetterSpacingGaps(text) * letterSpacingPx;
}

function countAsciiSpaces(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === ' ') count++;
  }
  return count;
}

function countLetterSpacingGaps(text: string): number {
  const units = Array.from(text).length;
  return units > 1 ? units - 1 : 0;
}
