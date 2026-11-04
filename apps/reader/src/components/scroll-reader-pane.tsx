import { useRef, useState } from 'react';
import { Copy, List, Loader2, Search, Settings } from 'lucide-react';
import { ScrollSelectionHandles, useScrollSelectionHandles } from '@ritojs/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FootnoteDrawer } from '@/components/footnote-drawer';
import { ImageLightbox } from '@/components/image-lightbox';
import { SelectionToolbar, type AnnotationKind } from '@/components/annotation-toolbar';
import { AnnotationDialog } from '@/components/annotation-dialog';
import { AnnotationTooltip } from '@/components/annotation-tooltip';
import type { useReader } from '@/hooks/use-reader';
import type { useScrollMode } from '@/hooks/use-scroll-mode';

interface ScrollReaderPaneProps {
  readonly containerRef: (node: HTMLElement | null) => void;
  readonly scroll: ReturnType<typeof useScrollMode>;
  readonly onOpenToc: () => void;
  readonly onOpenSearch: () => void;
  readonly onOpenSettings: () => void;
  /** The book's annotations, edited and removed from their dialog. */
  readonly annotations: ReturnType<typeof useReader>['annotations'];
  /** The annotation a tap opened and the one under the mouse. */
  readonly annotationPointer: ReturnType<typeof useReader>['scrollAnnotationPointer'];
  /** Makes the selection an annotation, as the paged reader's toolbar does. */
  readonly onAnnotate: (kind: AnnotationKind, color: string, note?: string) => void;
  readonly footnote: ReturnType<typeof useReader>['footnote'];
  readonly onCloseFootnote: () => void;
  readonly image: ReturnType<typeof useReader>['lightboxImage'];
  readonly onCloseImage: () => void;
  readonly onImageExitComplete: () => void;
}

/** The book read scrolled: the kit's scroll view and a small bar over it. */
export function ScrollReaderPane({
  containerRef,
  scroll,
  onOpenToc,
  onOpenSearch,
  onOpenSettings,
  annotations,
  annotationPointer,
  onAnnotate,
  footnote,
  onCloseFootnote,
  image,
  onCloseImage,
  onImageExitComplete,
}: ScrollReaderPaneProps) {
  const selected = scroll.selection?.text ?? '';
  // Handles show for a touch or a pen, as the paged reader's do.
  const [touchInput, setTouchInput] = useState(false);
  const view = useRef<HTMLDivElement | null>(null);
  // The toolbar stands over the selection's focus and moves with the strip.
  const handles = useScrollSelectionHandles(scroll.controller);
  const focus = handles?.focusEdge === 'start' ? handles.start : (handles?.end ?? null);
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
      <div
        ref={(node) => {
          scroll.containerRef(node);
          view.current = node;
        }}
        data-testid="scroll-view"
        className="absolute inset-0"
        onPointerDownCapture={(event) => {
          setTouchInput(event.pointerType === 'touch' || event.pointerType === 'pen');
        }}
      />
      <ScrollSelectionHandles
        controller={scroll.controller}
        rootRef={view}
        touchInput={touchInput}
      />
      {focus && <SelectionToolbar anchor={focus} onAnnotate={onAnnotate} />}
      <AnnotationTooltip hover={annotationPointer.hover} />
      <AnnotationDialog
        annotation={annotationPointer.opened}
        annotations={annotations}
        onClose={annotationPointer.close}
      />
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
      <div className="absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-md bg-background px-1 text-xs text-muted-foreground shadow-sm">
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
      <FootnoteDrawer footnote={footnote} onClose={onCloseFootnote} />
      <ImageLightbox image={image} onClose={onCloseImage} onExitComplete={onImageExitComplete} />
    </main>
  );
}
