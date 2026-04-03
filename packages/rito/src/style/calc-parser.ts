// calc() expression parser — tokenizes and evaluates CSS calc() to px values.

/** Token types produced by the calc tokenizer. */
type CalcToken =
  | { type: 'number'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

/** Mutable cursor over a token array. */
interface TokenCursor {
  tokens: readonly CalcToken[];
  pos: number;
}

/**
 * Evaluate a CSS calc() expression, resolving all units to px.
 *
 * @param raw - The full `calc(...)` string (lowercased).
 * @param parentFontSize - em basis in px.
 * @param rootFontSize - rem basis in px.
 * @returns The resolved value in px, or undefined if unparseable.
 */
export function evaluateCalc(
  raw: string,
  parentFontSize: number,
  rootFontSize: number = 16,
): number | undefined {
  const inner = raw.toLowerCase().slice(5, -1).trim();
  if (!inner) return undefined;

  const tokens = tokenizeCalc(inner, parentFontSize, rootFontSize);
  if (!tokens || tokens.length === 0) return undefined;

  const cursor: TokenCursor = { tokens, pos: 0 };
  const result = parseExpr(cursor);
  return cursor.pos === tokens.length ? result : undefined;
}

// ── Tokenizer ──────────────────────────────────────────────────────

function tokenizeCalc(expr: string, emBase: number, remBase: number): CalcToken[] | undefined {
  const tokens: CalcToken[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }

    if (ch === '+' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    if (ch === '-' && isOperatorMinus(tokens)) {
      tokens.push({ type: 'op', value: '-' });
      i++;
      continue;
    }

    const numResult = tryParseNumber(expr, i, emBase, remBase);
    if (numResult) {
      tokens.push({ type: 'number', value: numResult.resolved });
      i = numResult.end;
      continue;
    }

    return undefined;
  }

  return tokens;
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isOperatorMinus(tokens: CalcToken[]): boolean {
  const prev = tokens[tokens.length - 1];
  return !!prev && (prev.type === 'number' || (prev.type === 'paren' && prev.value === ')'));
}

// ── Number parsing ─────────────────────────────────────────────────

interface NumberResult {
  readonly resolved: number;
  readonly end: number;
}

function tryParseNumber(
  expr: string,
  start: number,
  emBase: number,
  remBase: number,
): NumberResult | undefined {
  let i = start;
  const ch = expr[i];

  if (ch !== '-' && ch !== '+' && ch !== '.' && !(ch !== undefined && ch >= '0' && ch <= '9')) {
    return undefined;
  }

  let numStr = '';
  if (ch === '-' || ch === '+') {
    numStr += ch;
    i++;
  }

  while (i < expr.length) {
    const c = expr[i];
    if ((c !== undefined && c >= '0' && c <= '9') || c === '.') {
      numStr += c;
      i++;
    } else {
      break;
    }
  }

  const { unit, end } = readUnit(expr, i);
  const num = parseFloat(numStr);
  if (isNaN(num)) return undefined;

  const resolved = resolveUnit(num, unit, emBase, remBase);
  if (resolved === undefined) return undefined;

  return { resolved, end };
}

function readUnit(expr: string, start: number): { unit: string; end: number } {
  let unit = '';
  let i = start;

  while (i < expr.length) {
    const c = expr[i];
    if (c !== undefined && c >= 'a' && c <= 'z') {
      unit += c;
      i++;
    } else {
      break;
    }
  }

  if (i < expr.length && expr[i] === '%') {
    unit = '%';
    i++;
  }

  return { unit, end: i };
}

function resolveUnit(
  num: number,
  unit: string,
  emBase: number,
  remBase: number,
): number | undefined {
  switch (unit) {
    case 'px':
    case '':
      return num;
    case 'pt':
      return num * (4 / 3);
    case 'em':
      return num * emBase;
    case 'rem':
      return num * remBase;
    case '%':
      return (num / 100) * emBase;
    default:
      return undefined;
  }
}

// ── Evaluator (recursive descent with cursor) ──────────────────────

/** expr = term (('+' | '-') term)* */
function parseExpr(c: TokenCursor): number | undefined {
  let left = parseTerm(c);
  if (left === undefined) return undefined;

  while (c.pos < c.tokens.length) {
    const t = c.tokens[c.pos];
    if (!t || t.type !== 'op' || (t.value !== '+' && t.value !== '-')) break;
    c.pos++;
    const right = parseTerm(c);
    if (right === undefined) return undefined;
    left = t.value === '+' ? left + right : left - right;
  }
  return left;
}

/** term = primary (('*' | '/') primary)* */
function parseTerm(c: TokenCursor): number | undefined {
  let left = parsePrimary(c);
  if (left === undefined) return undefined;

  while (c.pos < c.tokens.length) {
    const t = c.tokens[c.pos];
    if (!t || t.type !== 'op' || (t.value !== '*' && t.value !== '/')) break;
    c.pos++;
    const right = parsePrimary(c);
    if (right === undefined) return undefined;
    left = t.value === '*' ? left * right : right === 0 ? undefined : left / right;
    if (left === undefined) return undefined;
  }
  return left;
}

/** primary = NUMBER | '(' expr ')' */
function parsePrimary(c: TokenCursor): number | undefined {
  const t = c.tokens[c.pos];
  if (!t) return undefined;

  if (t.type === 'number') {
    c.pos++;
    return t.value;
  }

  if (t.type === 'paren' && t.value === '(') {
    c.pos++;
    const val = parseExpr(c);
    if (val === undefined) return undefined;
    const closing = c.tokens[c.pos];
    if (!closing || closing.type !== 'paren' || closing.value !== ')') return undefined;
    c.pos++;
    return val;
  }

  return undefined;
}
