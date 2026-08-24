import type { Reader } from '@ritojs/core';
import { describe, expect, it } from 'vitest';
import { resolveAnnotationSource } from '../src/controller/annotation-resolution/source-selector';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import {
  createAnnotationStore,
  type AnnotationRecord,
  type AnnotationTarget,
} from '../src/interaction';

describe('native annotation source selector', () => {
  it('converts quote fallback into a source request without consulting layout hit maps', () => {
    const fixture = createFixture({
      sourceRange: invalidSourceRange(),
      textQuote: { type: 'TextQuoteSelector', exact: 'bcd' },
    });

    expect(resolve(fixture)).toMatchObject({
      status: 'quote-fallback',
      request: {
        href: 'chapter.xhtml',
        sourceRange: {
          start: { nodePath: [0], textOffset: 1 },
          end: { nodePath: [0], textOffset: 4 },
        },
      },
    });
  });

  it('converts position and progression fallbacks into canonical source requests', () => {
    const position = createFixture({
      sourceRange: invalidSourceRange(),
      textQuote: { type: 'TextQuoteSelector', exact: 'missing' },
    });
    const progression = createFixture({
      sourceRange: invalidSourceRange(),
      textQuote: { type: 'TextQuoteSelector', exact: 'missing' },
      textPosition: { type: 'TextPositionSelector', start: 99, end: 100 },
      progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 0.5 },
    });

    expect(resolve(position)).toMatchObject({
      status: 'position-fallback',
      request: {
        href: 'chapter.xhtml',
        sourceRange: {
          start: { nodePath: [0], textOffset: 1 },
          end: { nodePath: [0], textOffset: 4 },
        },
      },
    });
    expect(resolve(progression)).toMatchObject({
      status: 'progression-fallback',
      request: {
        href: 'chapter.xhtml',
        sourceRange: {
          start: { nodePath: [0], textOffset: 3 },
          end: { nodePath: [0], textOffset: 4 },
        },
      },
    });
  });
});

interface Fixture {
  readonly record: AnnotationRecord;
  readonly reader: Reader;
  readonly state: ReturnType<typeof createCoordinatorState>;
}

function createFixture(selectorOverrides: Partial<AnnotationTarget['selectors']>): Fixture {
  const state = createCoordinatorState();
  state.chapterIndices.set('chapter.xhtml', {
    href: 'chapter.xhtml',
    normalizedText: 'abcdef',
    spans: [
      {
        nodePath: [0],
        sourceStart: 0,
        sourceEnd: 6,
        normalizedStart: 0,
        normalizedEnd: 6,
      },
    ],
  });
  const store = createAnnotationStore();
  const record = store.add({
    kind: 'highlight',
    target: {
      href: 'chapter.xhtml',
      selectors: {
        sourceRange: {
          type: 'SourceRangeSelector',
          start: { nodePath: [0], textOffset: 1 },
          end: { nodePath: [0], textOffset: 4 },
        },
        textQuote: { type: 'TextQuoteSelector', exact: 'bcd' },
        textPosition: { type: 'TextPositionSelector', start: 1, end: 4 },
        progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 1 / 6 },
        ...selectorOverrides,
      },
      text: { highlight: 'bcd' },
    },
  });
  const reader = {
    manifestHrefMap: new Map([['chapter-item', 'chapter.xhtml']]),
  } as unknown as Reader;
  return { reader, record, state };
}

function resolve(fixture: Fixture) {
  return resolveAnnotationSource(fixture.record, fixture.state, fixture.reader);
}

function invalidSourceRange(): AnnotationTarget['selectors']['sourceRange'] {
  return {
    type: 'SourceRangeSelector',
    start: { nodePath: [99], textOffset: 0 },
    end: { nodePath: [99], textOffset: 2 },
  };
}
