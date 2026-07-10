export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export interface PackageMetadata {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string;
}

export interface TocEntry {
  readonly label: string;
  readonly href: string;
  readonly children: readonly TocEntry[];
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaginationPolicy {
  readonly enabled?: boolean;
  readonly defaultOrphans?: number;
  readonly defaultWidows?: number;
}

export interface LayoutConfig {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly spreadMode: 'single' | 'double';
  readonly firstPageAlone: boolean;
  readonly spreadGap: number;
  readonly rootFontSize: number;
  readonly lineHeightOverride?: number | undefined;
  readonly lineHeightForce?: boolean | undefined;
  readonly fontFamilyOverride?: string | undefined;
  readonly fontFamilyForce?: boolean | undefined;
  readonly paginationPolicy?: PaginationPolicy | undefined;
}

export interface LayoutConfigInput {
  readonly width: number;
  readonly height: number;
  readonly margin?:
    | number
    | { readonly x: number; readonly y: number }
    | {
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
        readonly left: number;
      };
  readonly spread?: 'single' | 'double';
  readonly firstPageAlone?: boolean;
  readonly spreadGap?: number;
  readonly rootFontSize?: number;
  readonly lineHeightOverride?: number;
  readonly lineHeightForce?: boolean;
  readonly fontFamilyOverride?: string;
  readonly fontFamilyForce?: boolean;
  readonly paginationPolicy?: PaginationPolicy;
}

export interface Page {
  readonly index: number;
  readonly bounds: Rect;
  readonly content: readonly unknown[];
}

export interface Spread {
  readonly index: number;
  readonly left?: Page;
  readonly right?: Page;
}

export interface ChapterRange {
  readonly startPage: number;
  readonly endPage: number;
}

export interface ChapterTextSpan {
  readonly nodePath: readonly number[];
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
}

export interface ChapterTextIndex {
  readonly href: string;
  readonly normalizedText: string;
  readonly spans: readonly ChapterTextSpan[];
}

export type FootnoteKind = 'footnote' | 'endnote' | 'rearnote' | 'note';

export interface FootnoteEntry {
  readonly kind: FootnoteKind;
  readonly text: string;
  readonly html: string;
}

export interface TextPosition {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly charIndex: number;
}

export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

export interface SearchOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
}

export interface SearchResult {
  readonly pageIndex: number;
  readonly range: TextRange;
  readonly context: string;
}

export interface FontShorthand {
  readonly style: 'normal' | 'italic';
  readonly weight: number;
  readonly sizePx: number;
  readonly family: string;
}

export interface MeasurePaint {
  readonly font: FontShorthand;
  readonly wordSpacingPx?: number;
  readonly letterSpacingPx?: number;
}

export interface TextMetrics {
  readonly width: number;
  readonly height: number;
}

export interface TextMeasurer {
  measureText(text: string, paint: MeasurePaint): TextMetrics;
}
