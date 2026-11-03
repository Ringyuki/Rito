import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reader } from '@ritojs/core';
import type {
  AnnotationRecord,
  ResolvedAnnotation,
  ScrollController,
  ScrollHighlight,
} from '@ritojs/kit';

/** The colours the paged reader draws an annotation in when its record names none. */
const HIGHLIGHT = 'rgba(250, 204, 21, 0.3)';
const UNDERLINE = 'rgba(234, 88, 12, 0.85)';
/** A record's highlight id: `annotation:` and the record's id. */
const PREFIX = 'annotation:';

/**
 * The book's annotations as highlights of the book read scrolled: each
 * record found again in the book as it is now and resolved to the rects of
 * the pages laid out, again at each rest of the strip (`rest`), since the
 * pages laid out grow as the book is read.
 */
export function useScrollAnnotations(
  reader: Reader | null,
  records: readonly AnnotationRecord[],
  rest: unknown,
): readonly ScrollHighlight[] {
  const [highlights, setHighlights] = useState<readonly ScrollHighlight[]>([]);
  useEffect(() => {
    const interactions = reader?.interactions;
    if (!interactions || records.length === 0) {
      setHighlights([]);
      return;
    }
    let current = true;
    void Promise.all(
      records.map(async (record): Promise<ScrollHighlight | undefined> => {
        const located = await interactions.resolveAnnotationTarget?.(record.target);
        if (!located || located.level === 'orphaned') return undefined;
        const { href, sourceRange } = located.target;
        const found = await interactions.resolveExactSourceRange?.({ href, sourceRange });
        if (found?.status !== 'resolved') return undefined;
        const underline = record.kind === 'underline';
        return {
          id: `${PREFIX}${record.id}`,
          color: record.color ?? (underline ? UNDERLINE : HIGHLIGHT),
          zIndex: 1,
          mark: underline ? 'underline' : 'fill',
          rects: found.range.rects,
        };
      }),
    ).then((found) => {
      if (current) setHighlights(found.filter((each) => each !== undefined));
    });
    return () => {
      current = false;
    };
  }, [reader, records, rest]);
  return highlights;
}

/** The annotation a highlight drawn by {@link useScrollAnnotations} stands for. */
export function annotationOfHighlight(
  id: string,
  records: readonly AnnotationRecord[],
): AnnotationRecord | undefined {
  if (!id.startsWith(PREFIX)) return undefined;
  const recordId = id.slice(PREFIX.length);
  return records.find((record) => record.id === recordId);
}

/** An annotation the mouse rests on, and where its tooltip goes (screen coordinates). */
export interface ScrollAnnotationHover {
  readonly annotation: { readonly record: AnnotationRecord };
  readonly x: number;
  readonly y: number;
}

/**
 * The book's annotations under the pointer read scrolled, as the paged
 * reader has them: the one a tap opens to edit, the one a resting mouse
 * is over.
 */
export function useScrollAnnotationPointer(
  view: ScrollController | null,
  records: readonly AnnotationRecord[],
) {
  const [opened, setOpened] = useState<Pick<ResolvedAnnotation, 'id' | 'record'> | null>(null);
  const [hover, setHover] = useState<ScrollAnnotationHover | null>(null);
  const known = useRef(records);
  known.current = records;
  useEffect(() => {
    setHover(null);
    if (!view) return;
    const stops = [
      view.on('tap', ({ highlight }) => {
        const record = highlight ? annotationOfHighlight(highlight.id, known.current) : undefined;
        if (!record) return;
        setHover(null);
        setOpened({ id: record.id, record });
      }),
      view.on('highlightHover', ({ highlight }) => {
        const record = highlight ? annotationOfHighlight(highlight.id, known.current) : undefined;
        setHover(
          record && highlight
            ? {
                annotation: { record },
                x: highlight.bounds.x + highlight.bounds.width / 2,
                y: highlight.bounds.y,
              }
            : null,
        );
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [view]);
  const close = useCallback(() => {
    setOpened(null);
  }, []);
  return { opened, hover, close };
}
