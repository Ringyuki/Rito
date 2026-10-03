import { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import type { useReader } from '@/hooks/use-reader';

interface ReadingProgressProps {
  reader: ReturnType<typeof useReader>;
}

/**
 * Where the reader is: the chapter, the page and the whole-book progress
 * from the controller's `positionChange` events, and a slider that jumps
 * to a spread when released (a jump, not a page-turn animation).
 *
 * The bar keeps its height before a book opens: appearing afterwards would
 * shrink the reader and re-paginate the book it just laid out.
 */
export function ReadingProgress({ reader }: ReadingProgressProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  if (!reader.isLoaded || reader.totalSpreads === 0) {
    return (
      <footer aria-hidden className="h-[33px] shrink-0 border-t border-border bg-background/80" />
    );
  }

  const lastSpread = reader.totalSpreads - 1;
  const shownSpread = dragging ?? reader.currentSpread;
  const progress =
    reader.position.position?.progress ?? reader.currentSpread / Math.max(1, lastSpread);

  return (
    <footer
      data-testid="reading-progress"
      className="flex h-[33px] shrink-0 items-center gap-4 border-t border-border bg-background/80 px-4 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate">
        {reader.activeTocEntry?.label ?? reader.bookTitle}
      </span>
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
      />
      <span className="w-24 text-right tabular-nums">
        {String(shownSpread + 1)} / {String(reader.totalSpreads)} · {Math.round(progress * 100)}%
      </span>
    </footer>
  );
}
