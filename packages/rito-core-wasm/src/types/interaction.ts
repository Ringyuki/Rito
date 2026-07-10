export type RitoCoreWasmFootnoteKind = 'footnote' | 'endnote' | 'rearnote' | 'note';

export interface RitoCoreWasmFootnote {
  readonly revisionId: string;
  readonly key: string;
  readonly kind: RitoCoreWasmFootnoteKind;
  readonly text: string;
  readonly html: string;
}

export interface RitoCoreWasmFootnoteEntry {
  readonly kind: RitoCoreWasmFootnoteKind;
  readonly text: string;
  readonly html: string;
}

export interface RitoCoreWasmFootnotes {
  readonly revisionId: string;
  readonly entries: Readonly<Record<string, RitoCoreWasmFootnoteEntry>>;
}

export interface RitoCoreWasmChapterTextSpan {
  readonly nodePath: readonly number[];
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
}

export interface RitoCoreWasmChapterTextIndex {
  readonly href: string;
  readonly normalizedText: string;
  readonly spans: readonly RitoCoreWasmChapterTextSpan[];
}

export interface RitoCoreWasmChapterTextIndices {
  readonly revisionId: string;
  readonly entries: Readonly<Record<string, RitoCoreWasmChapterTextIndex>>;
}
