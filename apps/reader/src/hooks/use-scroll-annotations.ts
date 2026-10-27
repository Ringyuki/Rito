import { useEffect, useState } from 'react';
import type { Reader } from '@ritojs/core';
import type { AnnotationRecord, ScrollHighlight } from '@ritojs/kit';

/** The colours the paged reader draws an annotation in when its record names none. */
const HIGHLIGHT = 'rgba(250, 204, 21, 0.3)';
const UNDERLINE = 'rgba(234, 88, 12, 0.85)';

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
          id: `annotation:${record.id}`,
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
