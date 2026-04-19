import { useCallback, useState } from 'react';
import { useContainerSize } from '@ritojs/react';
import { Toaster } from '@/components/ui/sonner';
import { TocSidebar } from '@/components/toc-sidebar';
import { SearchBar } from '@/components/search-bar';
import { SettingsPanel, DEFAULT_SETTINGS } from '@/components/settings-panel';
import { useReader } from '@/hooks/use-reader';
import { useTheme } from '@/hooks/use-theme';
import { Reader } from '@/components/reader';

export function App() {
  const { theme, toggle: toggleTheme, setTheme } = useTheme();
  const [containerRef, containerSize] = useContainerSize();
  const reader = useReader(theme, containerSize.width, containerSize.height);
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
    reader.setFontScale(DEFAULT_SETTINGS.fontScale);
    // useBookLineHeight resets slider + deactivates override + clears force in one call.
    reader.useBookLineHeight();
    reader.setFontFamily(DEFAULT_SETTINGS.fontFamily);
    reader.setSpreadMode(DEFAULT_SETTINGS.spreadMode);
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
          fontScale: reader.fontScale,
          lineHeight: reader.lineHeight,
          lineHeightActive: reader.lineHeightActive,
          lineHeightForce: reader.lineHeightForce,
          fontFamily: reader.fontFamily,
          spreadMode: reader.spreadMode,
          theme,
        }}
        onFontScaleChange={reader.setFontScale}
        onLineHeightChange={reader.setLineHeight}
        onLineHeightForceChange={reader.setLineHeightForce}
        onUseBookLineHeight={reader.useBookLineHeight}
        onFontFamilyChange={reader.setFontFamily}
        onSpreadModeChange={reader.setSpreadMode}
        onThemeChange={setTheme}
        onRestoreDefaults={handleRestoreDefaults}
      />
    </div>
  );
}
