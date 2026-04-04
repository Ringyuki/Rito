export type CalcToken =
  | { type: 'number'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

export interface TokenCursor {
  tokens: readonly CalcToken[];
  pos: number;
}
