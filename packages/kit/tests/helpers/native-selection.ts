import type {
  ReaderTextRange,
  ReaderTextCaret,
  ReaderTextCaretResolution,
  ReaderTextSelectionInteractions,
} from '@ritojs/core';

export function capabilityFrom(
  resolveCaret: ReaderTextSelectionInteractions['resolveCaret'],
  resolveTextRange: ReaderTextSelectionInteractions['resolveTextRange'],
  resolveTextRangeFromPoints: ReaderTextSelectionInteractions['resolveTextRangeFromPoints'] = () =>
    Promise.resolve({ status: 'miss' }),
): ReaderTextSelectionInteractions {
  return capabilityWithRangeToPoint({ resolveCaret, resolveTextRange, resolveTextRangeFromPoints });
}

export function capabilityWithRangeToPoint(
  capability: Omit<ReaderTextSelectionInteractions, 'resolveTextRangeToPoint'>,
): ReaderTextSelectionInteractions {
  return {
    ...capability,
    resolveTextRangeToPoint: rangeToPointFrom(capability.resolveCaret, capability.resolveTextRange),
  };
}

export function rangeToPointFrom(
  resolveCaret: ReaderTextSelectionInteractions['resolveCaret'],
  resolveTextRange: ReaderTextSelectionInteractions['resolveTextRange'],
): NonNullable<ReaderTextSelectionInteractions['resolveTextRangeToPoint']> {
  return async (anchor, point) => {
    const focus = await resolveCaret(point);
    if (!focus || focus.status === 'miss') return focus;
    if (focus.status === 'unavailable') {
      return { status: 'unavailable', reason: focus.reason };
    }
    return resolveTextRange(anchor, focus.caret);
  };
}

export function point(x: number) {
  return { pageIndex: 0, x, y: 10 };
}

export function caret(textOffset: number, pageIndex = 0, href = 'chapter.xhtml'): ReaderTextCaret {
  return {
    pageIndex,
    geometry: { x: textOffset, y: 0, height: 18 },
    sourceLocator: {
      href,
      sourcePoint: { nodePath: [0], textOffset },
    },
  } as unknown as ReaderTextCaret;
}

export function resolvedCaret(caretValue: ReaderTextCaret): ReaderTextCaretResolution {
  return { status: 'resolved', pageIndex: caretValue.pageIndex, spreadIndex: 0, caret: caretValue };
}

export function exactRange(
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
  direction: 'forward' | 'backward' = 'forward',
  text = 'selected text',
): ReaderTextRange {
  const start = direction === 'forward' ? anchor : focus;
  const end = direction === 'forward' ? focus : anchor;
  const startOffset = start.sourceLocator.sourcePoint?.textOffset ?? 0;
  const endOffset = end.sourceLocator.sourcePoint?.textOffset ?? startOffset;
  const startHref = start.sourceLocator.href;
  const endHref = end.sourceLocator.href;
  const startPoint = { nodePath: [0], textOffset: startOffset };
  const endPoint = { nodePath: [0], textOffset: endOffset };
  return {
    anchor,
    focus,
    start,
    end,
    selectedText: text,
    sourceSpan: {
      start: {
        href: startHref,
        sourcePoint: startPoint,
      },
      end: {
        href: endHref,
        sourcePoint: endPoint,
      },
    },
    ...(startHref === endHref
      ? { sourceLocator: { href: startHref, sourceRange: { start: startPoint, end: endPoint } } }
      : {}),
    rects: [{ pageIndex: 0, spreadIndex: 0, x: 1, y: 2, width: 30, height: 18 }],
  };
}

export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
