import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Slider } from '@/components/ui/slider';
import { readerViewportMargin, type useReader } from '@/hooks/use-reader';

type Reader = ReturnType<typeof useReader>;

const BAR_HEIGHT = 33;

/**
 * The reader with its progress bar floating over the bottom of the page.
 * The bar takes no room, so showing or hiding it never resizes the reader
 * (which would lay the book out again), and while hidden it takes no input
 * either: it appears when the pointer reaches the page's bottom margin,
 * where no text is, or a touch lands there, and stays while it is pointed
 * at, dragged or focused.
 */
export function ReadingProgressArea({
  reader,
  width,
  children,
}: {
  readonly reader: Reader;
  readonly width: number;
  readonly children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
    },
    [],
  );

  const atBottom = (event: PointerEvent<HTMLDivElement>) => {
    const zone = revealed ? BAR_HEIGHT : readerViewportMargin(width);
    return event.clientY >= event.currentTarget.getBoundingClientRect().bottom - zone;
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
        clearTimeout(hideTimer.current);
        setRevealed(atBottom(event));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && event.buttons === 0) setRevealed(false);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' || !atBottom(event)) return;
        clearTimeout(hideTimer.current);
        setRevealed(true);
        hideTimer.current = setTimeout(() => {
          setRevealed(false);
        }, 3000);
      }}
    >
      {children}
      <ReadingProgress reader={reader} revealed={revealed} />
    </div>
  );
}

/**
 * Where the reader is: the chapter, the page and the whole-book progress
 * of the reading position, and a slider that jumps to a spread when
 * released (a jump, not a page-turn animation). While dragging, the
 * labels follow the slider.
 */
function ReadingProgress({ reader, revealed }: { readonly reader: Reader; revealed: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const position = reader.position.position;
  if (!reader.isLoaded || reader.totalSpreads === 0 || position === null) return null;

  // One source: the reading position (or the spread being dragged to), so
  // the chapter, the page and the percentage always describe the same place.
  const lastSpread = reader.totalSpreads - 1;
  const shownSpread = dragging ?? position.projection.spreadIndex;
  const progress = dragging === null ? position.progress : dragging / Math.max(1, lastSpread);
  const spread = reader.spreads[shownSpread];
  const chapter = spread
    ? reader.controller?.reader.findActiveTocEntry(spread.leftPageIndex)
    : undefined;

  return (
    <footer
      data-testid="reading-progress"
      data-revealed={revealed || dragging !== null ? 'true' : 'false'}
      style={{ height: BAR_HEIGHT }}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center gap-4 border-t border-border bg-background/90 px-4 text-xs text-muted-foreground opacity-0 transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100 data-[revealed=true]:pointer-events-auto data-[revealed=true]:opacity-100"
    >
      <span className="min-w-0 flex-1 truncate">{chapter?.label ?? reader.bookTitle}</span>
      <Slider
        aria-label="Reading position"
        className="w-1/3 max-w-xs"
        min={0}
        max={lastSpread}
        step={1}
        value={[shownSpread]}
        onValueChange={([value]) => {
          if (value !== undefined) setDragging(value);
        }}
        onValueCommit={([value]) => {
          setDragging(null);
          if (value !== undefined) reader.controller?.jumpToSpread(value);
        }}
        // The slider commits only a value that changed: a drag released
        // where it started commits nothing, so the drag also ends here or
        // the bar would keep showing it and stop following the page.
        onLostPointerCapture={() => {
          setDragging(null);
        }}
      />
      <span className="w-24 text-right tabular-nums">
        {String(shownSpread + 1)} / {String(reader.totalSpreads)} · {Math.round(progress * 100)}%
      </span>
    </footer>
  );
}
