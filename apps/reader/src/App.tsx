import { useCallback, useState } from 'react';
import { useContainerSize } from '@rito/react';
import { Toolbar } from '@/components/toolbar';
import { ProgressBar } from '@/components/progress-bar';
import { TocSidebar } from '@/components/toc-sidebar';
import { SearchBar } from '@/components/search-bar';
import { useReader } from '@/hooks/use-reader';
import { useTheme } from '@/hooks/use-theme';
import { Reader } from '@/components/reader';

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [containerRef, containerSize] = useContainerSize();
  const reader = useReader(theme, containerSize.width, containerSize.height);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const handleFileLoad = useCallback(
    (data: ArrayBuffer) => {
      void reader.loadFromArrayBuffer(data);
    },
    [reader],
  );

  return (
    <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background text-foreground">
      <Toolbar
        isLoaded={reader.isLoaded}
        isLoading={reader.isLoading}
        currentSpread={reader.currentSpread}
        totalSpreads={reader.spreads.length}
        spreadMode={reader.spreadMode}
        bookTitle={reader.bookTitle}
        theme={theme}
        onLoadDemo={() => {
          void reader.loadDemo();
        }}
        onFileLoad={handleFileLoad}
        onPrev={reader.prevSpread}
        onNext={reader.nextSpread}
        fontScale={reader.fontScale}
        onToggleSpread={reader.toggleSpreadMode}
        onToggleTheme={toggleTheme}
        onToggleToc={() => {
          setTocOpen((o) => !o);
        }}
        onToggleSearch={() => {
          setSearchOpen(true);
        }}
        onIncreaseFontSize={reader.increaseFontSize}
        onDecreaseFontSize={reader.decreaseFontSize}
      />

      <ProgressBar
        current={reader.currentSpread}
        total={reader.spreads.length}
        onSeek={reader.goToSpread}
      />

      <Reader containerRef={containerRef} reader={reader} />

      <SearchBar search={reader.search} open={searchOpen} onOpenChange={setSearchOpen} />

      <TocSidebar
        toc={reader.toc}
        open={tocOpen}
        onOpenChange={setTocOpen}
        onNavigate={reader.navigateToTocEntry}
        activeChapterHref={reader.activeChapterHref}
      />
    </div>
  );
}
