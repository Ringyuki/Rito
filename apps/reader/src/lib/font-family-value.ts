export function serializeFontFamilyName(name: string): string {
  let serialized = '"';

  for (const char of name) {
    if (char === '\\' || char === '"') {
      serialized += `\\${char}`;
      continue;
    }

    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) {
      serialized += ' ';
      continue;
    }

    serialized += char;
  }

  return `${serialized}"`;
}

export function getFontFamilyDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return value;

  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return value;
  }

  let display = '';

  for (let index = 1; index < trimmed.length - 1; index++) {
    const char = trimmed[index];
    if (char === undefined) continue;

    if (char === '\\' && index + 1 < trimmed.length - 1) {
      index++;
      const escaped = trimmed[index];
      if (escaped !== undefined) display += escaped;
      continue;
    }

    display += char;
  }

  return display;
}
