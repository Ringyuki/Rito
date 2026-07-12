import type { ReaderExactSourceRangeResolution } from '@ritojs/core';

export function resolvedRange(): Extract<
  ReaderExactSourceRangeResolution,
  { readonly status: 'resolved' }
> {
  return {
    status: 'resolved',
    range: {
      selectedText: 'bcd',
      sourceLocator: {
        href: 'chapter.xhtml',
        sourceRange: {
          start: { nodePath: [0], textOffset: 1 },
          end: { nodePath: [0], textOffset: 4 },
        },
      },
      rects: [
        { pageIndex: 0, spreadIndex: 0, x: 10, y: 20, width: 30, height: 12 },
        { pageIndex: 1, spreadIndex: 0, x: 5, y: 8, width: 9, height: 12 },
      ],
    },
  };
}

export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
