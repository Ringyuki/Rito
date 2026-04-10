import { useCallback, useState } from 'react';
import { useContainerSize, useControllerEvent } from '@rito/react';
import { TocSidebar } from '@/components/toc-sidebar';
import { SearchBar } from '@/components/search-bar';
import { ReaderOverlay } from '@/components/reader-overlay';
import { useReader } from '@/hooks/use-reader';
import { useTheme } from '@/hooks/use-theme';
import { useOverlay } from '@/hooks/use-overlay';
import { Reader } from '@/components/reader';

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [containerRef, containerSize] = useContainerSize();
  const reader = useReader(theme, containerSize.width, containerSize.height);
  const [tocOpen, setTocOpen] = useState(false);
  const overlay = useOverlay();

  // Suppress overlay toggle when a canvas tap triggers a content interaction
  useControllerEvent(reader.controller, 'linkClick', overlay.suppress);
  useControllerEvent(reader.controller, 'footnoteClick', overlay.suppress);
  useControllerEvent(reader.controller, 'imageClick', overlay.suppress);
  useControllerEvent(reader.controller, 'annotationClick', overlay.suppress);

  const handleFileLoad = useCallback(
    (data: ArrayBuffer) => {
      void reader.loadFromArrayBuffer(data);
    },
    [reader],
  );

  const handleToggleToc = useCallback(() => {
    setTocOpen((o) => !o);
    overlay.hide();
  }, [overlay]);

  const handleToggleSearch = useCallback(() => {
    reader.setSearchOpen(true);
    overlay.hide();
  }, [reader, overlay]);

  return (
    <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background text-foreground">
      <Reader containerRef={containerRef} reader={reader} />

      <SearchBar
        search={reader.search}
        open={reader.searchOpen}
        onOpenChange={reader.setSearchOpen}
      />

      <TocSidebar
        toc={reader.toc}
        open={tocOpen}
        onOpenChange={setTocOpen}
        onNavigate={reader.navigateToTocEntry}
        activeChapterHref={reader.activeChapterHref}
      />

      <ReaderOverlay
        visible={overlay.visible}
        isLoaded={reader.isLoaded}
        isLoading={reader.isLoading}
        bookTitle={reader.bookTitle}
        theme={theme}
        currentSpread={reader.currentSpread}
        totalSpreads={reader.spreads.length}
        fontScale={reader.fontScale}
        spreadMode={reader.spreadMode}
        onSeek={reader.goToSpread}
        onPrev={reader.prevSpread}
        onNext={reader.nextSpread}
        onToggleToc={handleToggleToc}
        onToggleSearch={handleToggleSearch}
        onIncreaseFontSize={reader.increaseFontSize}
        onDecreaseFontSize={reader.decreaseFontSize}
        onToggleTheme={toggleTheme}
        onToggleSpread={reader.toggleSpreadMode}
        onLoadDemo={() => {
          void reader.loadDemo();
        }}
        onFileLoad={handleFileLoad}
      />
    </div>
  );
}
