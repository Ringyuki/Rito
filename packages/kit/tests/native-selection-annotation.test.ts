import { describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '@ritojs/core';
import { buildAnnotationActions } from '../src/controller/facade/annotation-actions';
import type { ReaderControllerEvents } from '../src/controller/types';
import { createEmitter } from '../src/utils/event-emitter';
import {
  buildAnnotationTargetFromLocator,
  syncChapterIndices,
} from '../src/controller/annotation-resolution';
import type { Internals } from '../src/controller/core/internals';
import type { CoordinatorState } from '../src/controller/core/coordinator-state';

describe('native selection annotation target', () => {
  it('fails closed for a cross-resource selection without a compatible locator', () => {
    const add = vi.fn();
    const internals = {
      engines: {
        selection: {
          getSourceLocator: () => null,
          getSourceSpan: () => ({
            start: { href: 'chapter.xhtml', sourcePoint: { nodePath: [0], textOffset: 1 } },
            end: { href: 'next.xhtml', sourcePoint: { nodePath: [0], textOffset: 2 } },
          }),
        },
      },
      coordState: {
        annotationStore: { add, persist: () => Promise.resolve(), getAll: () => [] },
      },
    } as unknown as Internals;
    const actions = buildAnnotationActions(internals, createEmitter<ReaderControllerEvents>());

    expect(actions.addAnnotation({ kind: 'highlight' })).toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('keeps idrefs and resource hrefs in separate namespaces', () => {
    const first = { href: 'a.xhtml', normalizedText: 'a', spans: [] };
    const second = { href: 'chapter.xhtml', normalizedText: 'b', spans: [] };
    const state = { chapterIndices: new Map() } as unknown as CoordinatorState;
    const reader = {
      getChapterTextIndices: () =>
        new Map([
          ['chapter.xhtml', first],
          ['b', second],
        ]),
      manifestHrefMap: new Map([
        ['chapter.xhtml', 'a.xhtml'],
        ['b', 'chapter.xhtml'],
      ]),
    } as never;

    syncChapterIndices(state, reader);

    expect(state.chapterIndices.get('a.xhtml')).toBe(first);
    expect(state.chapterIndices.get('chapter.xhtml')).toBe(second);
    expect(state.chapterIndices.has('b')).toBe(false);
  });

  it('reuses the href projection while the Reader source Map is unchanged', () => {
    const chapter = { href: 'chapter.xhtml', normalizedText: 'text', spans: [] };
    const source = new Map([['chapter', chapter]]);
    const state = {
      chapterIndices: new Map(),
      chapterIndexSource: null,
    } as unknown as CoordinatorState;
    const reader = { getChapterTextIndices: () => source } as never;

    syncChapterIndices(state, reader);
    const projected = state.chapterIndices;
    syncChapterIndices(state, reader);

    expect(state.chapterIndices).toBe(projected);
    expect(state.chapterIndices.get('chapter.xhtml')).toBe(chapter);
  });

  it('derives persistent selectors directly from the exact source range', () => {
    const idref = 'chapter-item';
    const href = 'chapter.xhtml';
    const locator: ReaderLocator = {
      href,
      sourceRange: {
        start: { nodePath: [0], textOffset: 2 },
        end: { nodePath: [0], textOffset: 6 },
      },
    };
    const internals = {
      coordState: {
        chapterIndices: new Map([
          [
            href,
            {
              href,
              normalizedText: '0123456789',
              spans: [
                {
                  nodePath: [0],
                  sourceStart: 0,
                  sourceEnd: 10,
                  normalizedStart: 0,
                  normalizedEnd: 10,
                },
              ],
            },
          ],
        ]),
      },
      reader: {
        chapterMap: new Map([
          [idref, { startPage: 1, endPage: 1 }],
          ['cover-item', { startPage: 0, endPage: 0 }],
        ]),
        manifestHrefMap: new Map([
          ['cover-item', 'cover.xhtml'],
          [idref, href],
        ]),
      },
    } as unknown as Internals;

    const target = buildAnnotationTargetFromLocator(locator, internals);

    expect(target).toMatchObject({
      href,
      selectors: {
        sourceRange: locator.sourceRange,
        textPosition: { start: 2, end: 6 },
        progression: { chapter: 1 },
      },
      text: { highlight: '2345' },
    });
  });

  it('refuses a locator without an exact source range', () => {
    const internals = {
      coordState: { chapterIndices: new Map() },
      reader: { chapterMap: new Map() },
    } as unknown as Internals;

    expect(buildAnnotationTargetFromLocator({ href: 'chapter.xhtml' }, internals)).toBeUndefined();
  });

  it('preserves the native source identity at adjacent text-node boundaries', () => {
    const href = 'chapter.xhtml';
    const sourceRange = {
      start: { nodePath: [1], textOffset: 0 },
      end: { nodePath: [1], textOffset: 1 },
    };
    const target = buildAnnotationTargetFromLocator({ href, sourceRange }, {
      coordState: {
        chapterIndices: new Map([
          [
            href,
            {
              href,
              normalizedText: 'abcd',
              spans: [
                {
                  nodePath: [0],
                  sourceStart: 0,
                  sourceEnd: 2,
                  normalizedStart: 0,
                  normalizedEnd: 2,
                },
                {
                  nodePath: [1],
                  sourceStart: 0,
                  sourceEnd: 2,
                  normalizedStart: 2,
                  normalizedEnd: 4,
                },
              ],
            },
          ],
        ]),
      },
      reader: {
        chapterMap: new Map([['chapter-item', { startPage: 0, endPage: 0 }]]),
        manifestHrefMap: new Map([['chapter-item', href]]),
      },
    } as unknown as Internals);

    expect(target?.selectors.sourceRange).toEqual({
      type: 'SourceRangeSelector',
      ...sourceRange,
    });
    expect(target?.selectors.textPosition).toEqual({
      type: 'TextPositionSelector',
      start: 2,
      end: 3,
    });
  });

  it('resolves href locators against idref-keyed Reader navigation', () => {
    const href = 'chapter.xhtml';
    const chapterIndex = {
      href,
      normalizedText: '0123456789',
      spans: [
        {
          nodePath: [0],
          sourceStart: 0,
          sourceEnd: 10,
          normalizedStart: 0,
          normalizedEnd: 10,
        },
      ],
    };
    const target = buildAnnotationTargetFromLocator(
      {
        href,
        sourceRange: {
          start: { nodePath: [0], textOffset: 2 },
          end: { nodePath: [0], textOffset: 6 },
        },
      },
      {
        coordState: { chapterIndices: new Map([[href, chapterIndex]]) },
        reader: {
          chapterMap: new Map([['chapter-item', { startPage: 1, endPage: 1 }]]),
          manifestHrefMap: new Map([['chapter-item', href]]),
        },
      } as unknown as Internals,
    );
    expect(target).toBeDefined();
  });
});
