import { Copy, List, Loader2, Search, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { useScrollMode } from '@/hooks/use-scroll-mode';

interface ScrollReaderPaneProps {
  readonly containerRef: (node: HTMLElement | null) => void;
  readonly scroll: ReturnType<typeof useScrollMode>;
  readonly onOpenToc: () => void;
  readonly onOpenSearch: () => void;
  readonly onOpenSettings: () => void;
}

/** The book read scrolled: the kit's scroll view and a small bar over it. */
export function ScrollReaderPane({
  containerRef,
  scroll,
  onOpenToc,
  onOpenSearch,
  onOpenSettings,
}: ScrollReaderPaneProps) {
  const selected = scroll.selection?.text ?? '';
  return (
    <main
      ref={containerRef}
      data-testid="reader-shell"
      data-spread-mode="scrolled"
      data-loaded={scroll.isLoaded ? 'true' : 'false'}
      data-loading={scroll.isLoading ? 'true' : 'false'}
      data-scroll-progress={scroll.progress}
      data-selection-text-length={selected.length}
      className="relative flex min-h-0 flex-1 bg-muted/30 select-none"
    >
      <div ref={scroll.containerRef} data-testid="scroll-view" className="absolute inset-0" />
      {scroll.isLoading && (
        <div
          data-testid="reader-loading"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-muted-foreground"
        >
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading...</p>
        </div>
      )}
      {scroll.error && (
        <div
          data-testid="reader-error"
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {scroll.error}
          </div>
        </div>
      )}
      <div className="absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-md bg-background/80 px-1 text-xs text-muted-foreground shadow-sm">
        {selected.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy the selection"
            onClick={() => {
              void navigator.clipboard.writeText(selected).catch(() => {
                toast.error('Could not copy the selection');
              });
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Search" onClick={onOpenSearch}>
          <Search className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Table of contents" onClick={onOpenToc}>
          <List className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Settings" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
        </Button>
        <span className="px-1 tabular-nums">{Math.round(scroll.progress * 100)}%</span>
      </div>
    </main>
  );
}
