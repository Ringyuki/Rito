import type { CalcToken } from './types';

interface NumberResult {
  readonly resolved: number;
  readonly end: number;
}

export function tokenizeCalc(
  expr: string,
  emBase: number,
  remBase: number,
): CalcToken[] | undefined {
  const tokens: CalcToken[] = [];
  let index = 0;

  while (index < expr.length) {
    const ch = expr[index];

    if (isWhitespace(ch)) {
      index++;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      index++;
      continue;
    }

    if (ch === '+' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      index++;
      continue;
    }

    if (ch === '-' && isOperatorMinus(tokens)) {
      tokens.push({ type: 'op', value: '-' });
      index++;
      continue;
    }

    const numberResult = tryParseNumber(expr, index, emBase, remBase);
    if (!numberResult) return undefined;

    tokens.push({ type: 'number', value: numberResult.resolved });
    index = numberResult.end;
  }

  return tokens;
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isOperatorMinus(tokens: readonly CalcToken[]): boolean {
  const prev = tokens[tokens.length - 1];
  return !!prev && (prev.type === 'number' || (prev.type === 'paren' && prev.value === ')'));
}

function tryParseNumber(
  expr: string,
  start: number,
  emBase: number,
  remBase: number,
): NumberResult | undefined {
  let index = start;
  const firstChar = expr[index];

  if (
    firstChar !== '-' &&
    firstChar !== '+' &&
    firstChar !== '.' &&
    !(firstChar !== undefined && firstChar >= '0' && firstChar <= '9')
  ) {
    return undefined;
  }

  let numberText = '';
  if (firstChar === '-' || firstChar === '+') {
    numberText += firstChar;
    index++;
  }

  while (index < expr.length) {
    const char = expr[index];
    if ((char !== undefined && char >= '0' && char <= '9') || char === '.') {
      numberText += char;
      index++;
      continue;
    }
    break;
  }

  const { unit, end } = readUnit(expr, index);
  const numericValue = parseFloat(numberText);
  if (isNaN(numericValue)) return undefined;

  const resolved = resolveUnit(numericValue, unit, emBase, remBase);
  if (resolved === undefined) return undefined;

  return { resolved, end };
}

function readUnit(expr: string, start: number): { unit: string; end: number } {
  let unit = '';
  let index = start;

  while (index < expr.length) {
    const char = expr[index];
    if (char !== undefined && char >= 'a' && char <= 'z') {
      unit += char;
      index++;
      continue;
    }
    break;
  }

  if (expr[index] === '%') {
    unit = '%';
    index++;
  }

  return { unit, end: index };
}

function resolveUnit(
  value: number,
  unit: string,
  emBase: number,
  remBase: number,
): number | undefined {
  switch (unit) {
    case '':
    case 'px':
      return value;
    case 'pt':
      return value * (4 / 3);
    case 'em':
      return value * emBase;
    case 'rem':
      return value * remBase;
    case '%':
      return (value / 100) * emBase;
    default:
      return undefined;
  }
}
