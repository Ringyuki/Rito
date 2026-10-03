import { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import type { useReader } from '@/hooks/use-reader';

interface ReadingProgressProps {
  reader: ReturnType<typeof useReader>;
}

/**
 * Where the reader is: the chapter, the page and the whole-book progress
 * of the reading position, and a slider that jumps to a spread when
 * released (a jump, not a page-turn animation). While dragging, the
 * labels follow the slider.
 *
 * The bar keeps its height before a book opens: appearing afterwards would
 * shrink the reader and re-paginate the book it just laid out.
 */
export function ReadingProgress({ reader }: ReadingProgressProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const position = reader.position.position;
  if (!reader.isLoaded || reader.totalSpreads === 0 || position === null) {
    return (
      <footer aria-hidden className="h-[33px] shrink-0 border-t border-border bg-background/80" />
    );
  }

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
      className="flex h-[33px] shrink-0 items-center gap-4 border-t border-border bg-background/80 px-4 text-xs text-muted-foreground"
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
