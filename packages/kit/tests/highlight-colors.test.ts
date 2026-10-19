import { describe, expect, it, vi } from 'vitest';
import type { Reader, Spread } from '@ritojs/core';
import { buildLayoutActions } from '../src/controller/facade/layout-actions';
import type { Internals, RuntimeComponents } from '../src/controller/facade/types';
import type {
  CoordinatorEngines,
  CoordinatorState,
} from '../src/controller/core/coordinator-state';
import type { CoordinateMapper } from '../src/controller/geometry/coordinate-mapper';
import { DEFAULT_HIGHLIGHT_COLORS, withHighlightColors } from '../src/controller/overlay/colors';
import { mergeOverlayLayers } from '../src/controller/overlay/merger';
import { buildOverlayData } from '../src/controller/overlay/projection';
import type { AnnotationRecord, ResolvedAnnotation } from '../src/interaction';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';
import type { ReaderControllerEvents } from '../src/controller/types';

const rect = { x: 1, y: 2, width: 3, height: 4 };

describe('highlight colours', () => {
  it('keeps the colours a change leaves out', () => {
    const colors = withHighlightColors(DEFAULT_HIGHLIGHT_COLORS, { selection: 'blue' });
    expect(colors).toEqual({ ...DEFAULT_HIGHLIGHT_COLORS, selection: 'blue' });
  });

  it('marks an underline annotation with a line, in its own colour or the underline one', () => {
    const colors = { ...DEFAULT_HIGHLIGHT_COLORS, highlight: 'yellow', underline: 'orange' };
    const data = buildOverlayData(
      spread(),
      engines(),
      { interactions: { enabled: true } } as unknown as Reader,
      state([
        resolved('a', { kind: 'highlight' }),
        resolved('b', { kind: 'underline' }),
        resolved('c', { kind: 'underline', color: 'green' }),
        resolved('d', { kind: 'note' }),
      ]),
      identityMapper(),
      colors,
    );

    expect(data.annotationLayers.map(({ id, color, mark }) => ({ id, color, mark }))).toEqual([
      { id: 'a', color: 'yellow', mark: 'fill' },
      { id: 'b', color: 'orange', mark: 'underline' },
      { id: 'c', color: 'green', mark: 'underline' },
      { id: 'd', color: 'yellow', mark: 'fill' },
    ]);
  });

  it('paints selection and search in the colours given', () => {
    const colors = {
      ...DEFAULT_HIGHLIGHT_COLORS,
      selection: 's',
      searchMatch: 'm',
      searchActive: 'x',
    };
    const layers = mergeOverlayLayers([rect], [rect], [rect], [], colors);
    expect(layers.map((layer) => [layer.id, layer.color])).toEqual([
      ['search-match', 'm'],
      ['search-active', 'x'],
      ['selection', 's'],
    ]);
  });

  it('repaints every overlay, and only the overlays, when the colours change', () => {
    const markAllOverlaysDirty = vi.fn();
    const invalidateAllContent = vi.fn();
    const internals = { highlightColors: DEFAULT_HIGHLIGHT_COLORS } as unknown as Internals;
    const runtime = {
      frameDriver: { markAllOverlaysDirty },
      pool: { invalidateAllContent },
    } as unknown as RuntimeComponents;
    const actions = buildLayoutActions(
      internals,
      createEmitter<ReaderControllerEvents>(),
      runtime,
      createDisposableCollection(),
    );

    actions.setHighlightColors({ underline: 'red' });

    expect(internals.highlightColors).toEqual({ ...DEFAULT_HIGHLIGHT_COLORS, underline: 'red' });
    expect(markAllOverlaysDirty).toHaveBeenCalledTimes(1);
    expect(invalidateAllContent).not.toHaveBeenCalled();
  });
});

function spread(): Spread {
  return { index: 0, pageIndexes: [0] } as unknown as Spread;
}

function engines(): CoordinatorEngines {
  return {
    selection: { getRects: () => [] },
    search: { getResults: () => [], getActiveIndex: () => -1 },
  } as unknown as CoordinatorEngines;
}

function state(annotations: readonly ResolvedAnnotation[]): CoordinatorState {
  return {
    resolvedAnnotations: annotations,
    nativeSearchGeometry: { alive: false },
  } as unknown as CoordinatorState;
}

function resolved(
  id: string,
  record: Pick<AnnotationRecord, 'kind'> & { readonly color?: string },
): ResolvedAnnotation {
  return {
    id,
    record: { id, createdAt: 0, ...record } as unknown as AnnotationRecord,
    status: 'exact',
    segments: [{ pageIndex: 0, rects: [rect] }],
  };
}

function identityMapper(): CoordinateMapper {
  return {
    pageContentToViewport: (_page: number, r: typeof rect) => r,
    spreadContentRectToViewport: (r: typeof rect) => r,
  } as unknown as CoordinateMapper;
}
