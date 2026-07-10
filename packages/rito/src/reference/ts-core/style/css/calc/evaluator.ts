import type { CalcToken, TokenCursor } from './types';

export function evaluateTokens(tokens: readonly CalcToken[]): number | undefined {
  const cursor: TokenCursor = { tokens, pos: 0 };
  const result = parseExpr(cursor);
  return cursor.pos === tokens.length ? result : undefined;
}

function parseExpr(cursor: TokenCursor): number | undefined {
  let left = parseTerm(cursor);
  if (left === undefined) return undefined;

  while (cursor.pos < cursor.tokens.length) {
    const token = cursor.tokens[cursor.pos];
    if (!token || token.type !== 'op' || (token.value !== '+' && token.value !== '-')) break;

    cursor.pos++;
    const right = parseTerm(cursor);
    if (right === undefined) return undefined;
    left = token.value === '+' ? left + right : left - right;
  }

  return left;
}

function parseTerm(cursor: TokenCursor): number | undefined {
  let left = parsePrimary(cursor);
  if (left === undefined) return undefined;

  while (cursor.pos < cursor.tokens.length) {
    const token = cursor.tokens[cursor.pos];
    if (!token || token.type !== 'op' || (token.value !== '*' && token.value !== '/')) break;

    cursor.pos++;
    const right = parsePrimary(cursor);
    if (right === undefined) return undefined;
    left = token.value === '*' ? left * right : right === 0 ? undefined : left / right;
    if (left === undefined) return undefined;
  }

  return left;
}

function parsePrimary(cursor: TokenCursor): number | undefined {
  const token = cursor.tokens[cursor.pos];
  if (!token) return undefined;

  if (token.type === 'number') {
    cursor.pos++;
    return token.value;
  }

  if (token.type === 'paren' && token.value === '(') {
    cursor.pos++;
    const value = parseExpr(cursor);
    if (value === undefined) return undefined;

    const closing = cursor.tokens[cursor.pos];
    if (!closing || closing.type !== 'paren' || closing.value !== ')') return undefined;
    cursor.pos++;
    return value;
  }

  return undefined;
}
