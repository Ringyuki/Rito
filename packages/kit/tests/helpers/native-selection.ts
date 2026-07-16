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
  return { resolveCaret, resolveTextRange, resolveTextRangeFromPoints };
}

export function point(x: number) {
  return { pageIndex: 0, x, y: 10 };
}

export function caret(textOffset: number, pageIndex = 0): ReaderTextCaret {
  return {
    pageIndex,
    geometry: { x: textOffset, y: 0, height: 18 },
    sourceLocator: {
      href: 'chapter.xhtml',
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
  return {
    anchor,
    focus,
    start,
    end,
    selectedText: text,
    sourceLocator: {
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [0], textOffset: startOffset },
        end: { nodePath: [0], textOffset: endOffset },
      },
    },
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
