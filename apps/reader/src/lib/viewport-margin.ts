/** The page margin the reader app reads a book with in a view `containerWidth` wide. */
export function readerViewportMargin(containerWidth: number): number {
  return containerWidth < 640 ? 16 : containerWidth < 1024 ? 32 : 50;
}
