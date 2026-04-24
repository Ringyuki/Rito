import { LineBreaker } from 'css-line-break';
import type { LineBreak, WordBreak } from '../../style/core/types';

export type BreakBlockReason = 'line-start' | 'line-end' | 'boundary';

export interface BreakClassification {
  readonly allowed: boolean;
  readonly reason?: BreakBlockReason;
}

export interface LineBreakOptions {
  readonly lineBreak?: LineBreak;
  readonly wordBreak?: WordBreak;
  readonly language?: string;
}

interface GraphemeSegment {
  readonly segment: string;
}

interface GraphemeSegmenter {
  segment(input: string): Iterable<GraphemeSegment>;
}

interface GraphemeSegmenterConstructor {
  new (
    locales?: string | readonly string[],
    options?: { readonly granularity: 'grapheme' },
  ): GraphemeSegmenter;
}

const EAST_ASIAN_BREAK_RE =
  /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}\u3000-\u303F\uFF00-\uFFEF]/u;

const GRAPHEME_SEGMENTER = (Intl as { readonly Segmenter?: GraphemeSegmenterConstructor })
  .Segmenter;
let graphemeSegmenter: GraphemeSegmenter | undefined;

export function classifyTextBreak(
  text: string,
  offset: number,
  options?: LineBreakOptions,
): BreakClassification {
  if (offset <= 0 || offset >= text.length) return { allowed: false, reason: 'boundary' };
  return getLineBreakOffsets(text, options).has(offset)
    ? { allowed: true }
    : { allowed: false, reason: 'line-start' };
}

export function canBreakTextAt(text: string, offset: number, options?: LineBreakOptions): boolean {
  return classifyTextBreak(text, offset, options).allowed;
}

export function getLineBreakOffsets(text: string, options?: LineBreakOptions): ReadonlySet<number> {
  const offsets = new Set<number>();
  let offset = 0;
  for (const segment of splitLineBreakSegments(text, options)) {
    offset += segment.length;
    if (offset > 0 && offset < text.length) offsets.add(offset);
  }
  return offsets;
}

export function splitLineBreakSegments(text: string, options?: LineBreakOptions): string[] {
  const breaker = LineBreaker(text, {
    lineBreak: resolveLineBreak(text, options),
    wordBreak: options?.wordBreak ?? 'normal',
  });
  const segments: string[] = [];
  let next = breaker.next();
  while (!next.done) {
    segments.push(next.value.slice());
    next = breaker.next();
  }
  return segments;
}

export function containsEastAsianBreakChar(text: string): boolean {
  return EAST_ASIAN_BREAK_RE.test(text);
}

export function splitTextUnits(text: string): string[] {
  if (!GRAPHEME_SEGMENTER) return Array.from(text);
  graphemeSegmenter ??= new GRAPHEME_SEGMENTER(undefined, { granularity: 'grapheme' });
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

export function adjustBreakPosition(
  text: string,
  start: number,
  end: number,
  candidate: number,
  maxWidth: number,
  measureWidth: (end: number) => number,
  options?: LineBreakOptions,
): number {
  if (candidate <= start || candidate >= end) return candidate;
  const offsets = getLineBreakOffsets(text, options);
  if (offsets.has(candidate)) return candidate;

  const backward = findBackwardBreak(start, candidate, offsets);
  if (backward !== undefined) return backward;

  const forward = findForwardFittingBreak(candidate + 1, end, maxWidth, offsets, measureWidth);
  return forward ?? candidate;
}

function resolveLineBreak(
  text: string,
  options: LineBreakOptions | undefined,
): 'normal' | 'strict' {
  const requested = options?.lineBreak;
  if (requested === 'normal' || requested === 'strict') return requested;
  return isStrictLineBreakLanguage(options?.language) || containsEastAsianBreakChar(text)
    ? 'strict'
    : 'normal';
}

function isStrictLineBreakLanguage(language: string | undefined): boolean {
  if (!language || language === 'und') return false;
  const primary = language.split('-')[0]?.toLowerCase();
  return primary === 'ja' || primary === 'zh' || primary === 'ko';
}

function findBackwardBreak(
  start: number,
  candidate: number,
  offsets: ReadonlySet<number>,
): number | undefined {
  for (let pos = candidate - 1; pos > start; pos--) {
    if (offsets.has(pos)) return pos;
  }
  return undefined;
}

function findForwardFittingBreak(
  start: number,
  end: number,
  maxWidth: number,
  offsets: ReadonlySet<number>,
  measureWidth: (end: number) => number,
): number | undefined {
  for (let pos = start; pos < end; pos++) {
    if (offsets.has(pos) && measureWidth(pos) <= maxWidth) return pos;
  }
  return undefined;
}
