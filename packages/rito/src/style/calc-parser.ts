import { evaluateTokens } from './calc-parser/evaluator';
import { tokenizeCalc } from './calc-parser/tokenizer';

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

  return evaluateTokens(tokens);
}
