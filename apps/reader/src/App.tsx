import { useCallback, useState } from 'react';
import { Toolbar } from '@/components/toolbar';
import { TocSidebar } from '@/components/toc-sidebar';
import { EpubCanvas } from '@/components/epub-canvas';
import { useEpub } from '@/hooks/use-epub';
import { useTheme } from '@/hooks/use-theme';
import { useContainerSize } from '@/hooks/use-container-size';

export function App() {
  const [containerRef, containerSize] = useContainerSize();
  const { theme, toggle: toggleTheme } = useTheme();
  const epub = useEpub(containerSize, theme);
  const [tocOpen, setTocOpen] = useState(false);

  const handleFileLoad = useCallback(
    (data: ArrayBuffer, name: string) => {
      void epub.loadFromArrayBuffer(data, name);
    },
    [epub],
  );

  return (
    <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background text-foreground">
      <Toolbar
        isLoaded={epub.isLoaded}
        isLoading={epub.isLoading}
        currentSpread={epub.currentSpread}
        totalSpreads={epub.spreads.length}
        spreadMode={epub.spreadMode}
        theme={theme}
        onLoadDemo={() => {
          void epub.loadDemo();
        }}
        onFileLoad={handleFileLoad}
        onPrev={epub.prevSpread}
        onNext={epub.nextSpread}
        onToggleSpread={epub.toggleSpreadMode}
        onToggleTheme={toggleTheme}
        onToggleToc={() => {
          setTocOpen((o) => !o);
        }}
      />

      <main
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden bg-muted/30"
      >
        {!epub.isLoaded && !epub.isLoading && !epub.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-lg">Open an EPUB to start reading</p>
            <p className="text-sm">Use the toolbar to load a demo or open a file</p>
          </div>
        )}

        {epub.error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-6 py-4 text-sm text-destructive">
              {epub.error}
            </div>
          </div>
        )}

        <EpubCanvas
          canvasRef={epub.canvasRef}
          width={epub.canvasSize.width}
          height={epub.canvasSize.height}
          onPrev={epub.prevSpread}
          onNext={epub.nextSpread}
          onFirst={() => {
            epub.goToSpread(0);
          }}
          onLast={() => {
            epub.goToSpread(epub.spreads.length - 1);
          }}
        />
      </main>

      <TocSidebar
        toc={epub.toc}
        open={tocOpen}
        onOpenChange={setTocOpen}
        onNavigate={epub.navigateToTocEntry}
      />
    </div>
  );
}
