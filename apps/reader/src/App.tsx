import { useCallback, useState } from 'react';
import type { ReaderPinnedFontPolicy } from '@ritojs/core';
import { useContainerSize, useReaderAutoResize } from '@ritojs/react';
import { Toaster } from '@/components/ui/sonner';
import { TocSidebar } from '@/components/toc-sidebar';
import { SearchBar } from '@/components/search-bar';
import { SettingsPanel, DEFAULT_SETTINGS } from '@/components/settings-panel';
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
    zoomScale: reader.zoomScale,
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
    reader.setZoomScale(DEFAULT_SETTINGS.zoomScale);
    // useBookLineHeight resets slider + deactivates override + clears force in one call.
    reader.useBookLineHeight();
    reader.setFontFamily(DEFAULT_SETTINGS.fontFamily);
    reader.setSpreadMode(DEFAULT_SETTINGS.spreadMode);
    reader.setLineBreaking(DEFAULT_SETTINGS.lineBreaking);
    setTheme(DEFAULT_SETTINGS.theme);
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
        onFileLoad={handleFileLoad}
      />

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

      <Toaster />

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={{
          zoomScale: reader.zoomScale,
          lineHeight: reader.lineHeight,
          lineHeightActive: reader.lineHeightActive,
          lineHeightForce: reader.lineHeightForce,
          fontFamily: reader.fontFamily,
          spreadMode: reader.spreadMode,
          lineBreaking: reader.lineBreaking,
          theme,
        }}
        onZoomScaleChange={reader.setZoomScale}
        onLineHeightChange={reader.setLineHeight}
        onLineHeightForceChange={reader.setLineHeightForce}
        onUseBookLineHeight={reader.useBookLineHeight}
        onFontFamilyChange={reader.setFontFamily}
        onSpreadModeChange={reader.setSpreadMode}
        onLineBreakingChange={reader.setLineBreaking}
        onThemeChange={setTheme}
        onRestoreDefaults={handleRestoreDefaults}
      />
    </div>
  );
}
