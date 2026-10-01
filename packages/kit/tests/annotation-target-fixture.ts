import type { AnnotationTarget } from '../src/interaction/index';

/** An engine-shaped target over `exact`, starting at the chapter's first text node. */
export function annotationTarget(exact = 'text', href = 'chapter.xhtml'): AnnotationTarget {
  return {
    version: 1,
    href,
    sourceRange: {
      start: { nodePath: [0], textOffset: 0 },
      end: { nodePath: [0], textOffset: exact.length },
    },
    quote: { exact, prefix: '', suffix: '' },
    position: { start: 0, end: exact.length, chapterLength: exact.length },
  };
}
