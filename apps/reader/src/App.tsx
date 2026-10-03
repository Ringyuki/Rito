import { useCallback, useState } from 'react';
import type { ReaderPinnedFontPolicy } from '@ritojs/core';
import { useContainerSize, useReaderAutoResize } from '@ritojs/react';
import { Toaster } from '@/components/ui/sonner';
import { TocSidebar } from '@/components/toc-sidebar';
import { SearchBar } from '@/components/search-bar';
import { SettingsPanel } from '@/components/settings-panel';
import { ReadingProgress } from '@/components/reading-progress';
import { readerViewportMargin, useReader } from '@/hooks/use-reader';
import { useTheme } from '@/hooks/use-theme';
import { Reader } from '@/components/reader';

interface AppProps {
  readonly pinnedFontPolicy: ReaderPinnedFontPolicy;
}

export function App({ pinnedFontPolicy }: AppProps) {
  const { theme, toggle: toggleTheme, setTheme } = useTheme();
  const [sizeRef, containerSize] = useContainerSize();
  const reader = useReader(theme, containerSize.width, containerSize.height, pinnedFontPolicy);
  const resizeRef = useReaderAutoResize(reader.controller, {
    margin: ({ width }) => readerViewportMargin(width),
  });
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleToggleSearch = useCallback(() => {
    reader.setSearchOpen(true);
  }, [reader]);

  const handleOpenToc = useCallback(() => {
    setTocOpen(true);
  }, []);

  const handleToggleSettings = useCallback(() => {
    setSettingsOpen((o) => !o);
  }, []);

  const handleRestoreDefaults = useCallback(() => {
    reader.typography.reset();
    reader.setSpreadMode('double');
    reader.setRenderScale(1);
    reader.setPageTurn('slide');
    setTheme('light');
  }, [reader, setTheme]);

  const handleFileLoad = useCallback(
    (data: ArrayBuffer) => {
      void reader.loadFromArrayBuffer(data);
    },
    [reader],
  );

  const handleLoadDemo = useCallback(() => {
    void reader.loadDemo();
  }, [reader]);

  const handleLoadShardedDemo = useCallback(() => {
    void reader.loadShardedDemo();
  }, [reader]);

  const containerRef = useCallback(
    (node: HTMLElement | null) => {
      sizeRef(node);
      resizeRef(node);
    },
    [resizeRef, sizeRef],
  );

  return (
    <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background text-foreground">
      <Reader
        containerRef={containerRef}
        reader={reader}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenToc={handleOpenToc}
        onOpenSearch={handleToggleSearch}
        onOpenSettings={handleToggleSettings}
        onLoadDemo={handleLoadDemo}
        onLoadShardedDemo={handleLoadShardedDemo}
        onFileLoad={handleFileLoad}
      />

      <ReadingProgress reader={reader} />

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
        activeEntry={reader.activeTocEntry}
      />

      <Toaster />

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={{
          ...reader.typography.typography,
          spreadMode: reader.spreadMode,
          theme,
          renderScale: reader.renderScale,
          pageTurn: reader.pageTurn,
        }}
        fonts={reader.fonts}
        onFontSizeChange={reader.typography.setFontSize}
        onLineHeightChange={reader.typography.setLineHeight}
        onLineHeightForceChange={reader.typography.setLineHeightForce}
        onUseBookLineHeight={reader.typography.useBookLineHeight}
        onFontFamilyChange={reader.typography.setFontFamily}
        onFontFamilyForceChange={reader.typography.setFontFamilyForce}
        onRenderScaleChange={reader.setRenderScale}
        onPageTurnChange={reader.setPageTurn}
        onSpreadModeChange={reader.setSpreadMode}
        onThemeChange={setTheme}
        onRestoreDefaults={handleRestoreDefaults}
      />
    </div>
  );
}
