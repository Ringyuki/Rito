import { Loader2 } from 'lucide-react';
import { Reader as RitoReader } from '@ritojs/react';
import { Placeholder } from '@/components/placeholder';
import { FileActions } from '@/components/file-actions';
import { AnnotationToolbar } from '@/components/annotation-toolbar';
import { AnnotationDialog } from '@/components/annotation-dialog';
import { AnnotationTooltip } from '@/components/annotation-tooltip';
import { FootnoteDrawer } from '@/components/footnote-drawer';
import { LinkDialog } from '@/components/link-dialog';
import { ImageLightbox } from '@/components/image-lightbox';
import { ReaderContextMenu } from '@/components/reader-context-menu';
import { type useReader } from '@/hooks/use-reader';
import { Button } from '@/components/ui/button';
import { SiGithub } from '@icons-pack/react-simple-icons';

interface ReaderProps {
  containerRef: (node: HTMLElement | null) => void;
  reader: ReturnType<typeof useReader>;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenToc: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onLoadDemo: () => void;
  onFileLoad: (data: ArrayBuffer) => void;
}

export function Reader({
  containerRef,
  reader,
  theme,
  onToggleTheme,
  onOpenToc,
  onOpenSearch,
  onOpenSettings,
  onLoadDemo,
  onFileLoad,
}: ReaderProps) {
  return (
    <main ref={containerRef} className="relative flex flex-1 bg-muted/30 select-none">
      {reader.isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading...</p>
        </div>
      )}

      {!reader.isLoaded && (
        <div className="fixed z-20 top-0 w-full p-4 flex gap-2 items-center justify-center text-muted-foreground">
          <span className="text-sm font-medium">Rito Reader</span>
          <a href="https://github.com/Ringyuki/Rito" target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon">
              <SiGithub className="h-4 w-4" />
            </Button>
          </a>
        </div>
      )}

      {!reader.isLoaded && !reader.isLoading && !reader.error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <p className="text-lg font-medium">Open an EPUB to start reading</p>
          <div className="flex gap-3">
            <FileActions onLoadDemo={onLoadDemo} onFileLoad={onFileLoad} />
          </div>
        </div>
      )}

      {reader.error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {reader.error}
          </div>
        </div>
      )}

      <ReaderContextMenu
        reader={reader}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenToc={onOpenToc}
        onOpenSearch={onOpenSearch}
        onOpenSettings={onOpenSettings}
        onLoadDemo={onLoadDemo}
        onFileLoad={onFileLoad}
      >
        <RitoReader
          controller={reader.controller}
          className="relative flex flex-1 items-center justify-center select-none"
          placeholder={<Placeholder />}
        />
      </ReaderContextMenu>

      <AnnotationToolbar
        selection={reader.selection}
        annotations={reader.annotations}
        controller={reader.controller}
        zoomScale={reader.zoomScale}
      />

      <AnnotationTooltip hover={reader.annotations.hover} />

      <AnnotationDialog
        annotation={reader.annotations.clickedAnnotation}
        annotations={reader.annotations}
        onClose={reader.annotations.clearClicked}
      />

      <FootnoteDrawer footnote={reader.footnote} onClose={reader.dismissFootnote} />

      <LinkDialog
        link={reader.pendingLink}
        currentSpread={reader.currentSpread}
        goToSpread={reader.goToSpread}
        onClose={reader.dismissLink}
      />

      <ImageLightbox
        image={reader.lightboxImage}
        onClose={reader.dismissLightbox}
        onExitComplete={reader.onLightboxExitComplete}
      />
    </main>
  );
}
