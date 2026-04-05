import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  List,
  Minus,
  Moon,
  MoreHorizontal,
  Plus,
  Rows2,
  Search,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ProgressBar } from '@/components/progress-bar';
import { FileActions } from '@/components/file-actions';
import { cn } from '@/lib/utils';

interface MobileOverlayProps {
  visible: boolean;
  isLoaded: boolean;
  isLoading: boolean;
  bookTitle: string;
  theme: 'light' | 'dark';
  currentSpread: number;
  totalSpreads: number;
  fontScale: number;
  spreadMode: 'single' | 'double';
  onSeek: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleToc: () => void;
  onToggleSearch: () => void;
  onIncreaseFontSize: () => void;
  onDecreaseFontSize: () => void;
  onToggleTheme: () => void;
  onToggleSpread: () => void;
  onLoadDemo: () => void;
  onFileLoad: (data: ArrayBuffer) => void;
}

export function MobileOverlay({
  visible,
  isLoaded,
  isLoading,
  bookTitle,
  theme,
  currentSpread,
  totalSpreads,
  fontScale,
  spreadMode,
  onSeek,
  onPrev,
  onNext,
  onToggleToc,
  onToggleSearch,
  onIncreaseFontSize,
  onDecreaseFontSize,
  onToggleTheme,
  onToggleSpread,
  onLoadDemo,
  onFileLoad,
}: MobileOverlayProps): React.JSX.Element | null {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div
      className={cn(
        'fixed inset-0 z-40 flex flex-col justify-between lg:hidden',
        'transition-opacity duration-200',
        visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="absolute inset-0 bg-black/20" />

      <div
        className={cn(
          'relative z-10 flex items-center justify-center border-b border-border bg-background/90 px-4 py-4 backdrop-blur',
          'transition-transform duration-200',
          visible ? 'translate-y-0' : '-translate-y-full',
        )}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <span className="truncate text-sm font-medium">{bookTitle || 'Rito Reader'}</span>
      </div>

      <div
        className={cn(
          'relative z-10 flex flex-col border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur',
          'transition-transform duration-200',
          visible ? 'translate-y-0' : 'translate-y-full',
        )}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <ProgressBar current={currentSpread} total={totalSpreads} onSeek={onSeek} className="h-2" />

        {totalSpreads > 0 && (
          <p className="py-1 text-center text-xs text-muted-foreground">
            {currentSpread + 1} / {totalSpreads}
          </p>
        )}

        <div className="flex items-center justify-around px-2 py-2">
          <Button variant="ghost" size="icon" onClick={onToggleToc} disabled={!isLoaded}>
            <List className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onToggleSearch} disabled={!isLoaded}>
            <Search className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDecreaseFontSize} disabled={!isLoaded}>
            <Minus className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onIncreaseFontSize} disabled={!isLoaded}>
            <Plus className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onToggleTheme}>
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setMoreOpen(true);
            }}
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <MoreDrawer
        open={moreOpen}
        onOpenChange={setMoreOpen}
        isLoaded={isLoaded}
        isLoading={isLoading}
        fontScale={fontScale}
        spreadMode={spreadMode}
        currentSpread={currentSpread}
        totalSpreads={totalSpreads}
        onPrev={onPrev}
        onNext={onNext}
        onToggleSpread={onToggleSpread}
        onLoadDemo={onLoadDemo}
        onFileLoad={onFileLoad}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface MoreDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoaded: boolean;
  isLoading: boolean;
  fontScale: number;
  spreadMode: 'single' | 'double';
  currentSpread: number;
  totalSpreads: number;
  onPrev: () => void;
  onNext: () => void;
  onToggleSpread: () => void;
  onLoadDemo: () => void;
  onFileLoad: (data: ArrayBuffer) => void;
}

function MoreDrawer({
  open,
  onOpenChange,
  isLoaded,
  isLoading,
  fontScale,
  spreadMode,
  currentSpread,
  totalSpreads,
  onPrev,
  onNext,
  onToggleSpread,
  onLoadDemo,
  onFileLoad,
}: MoreDrawerProps): React.JSX.Element {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>More Options</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          <FileActions
            isLoading={isLoading}
            onLoadDemo={() => {
              onLoadDemo();
              onOpenChange(false);
            }}
            onFileLoad={onFileLoad}
            demoLabel="Load Demo Book"
            openLabel="Open EPUB File"
            className="w-full justify-center"
          />

          <Separator />

          <Button variant="outline" onClick={onToggleSpread} disabled={!isLoaded}>
            {spreadMode === 'single' ? (
              <Columns2 className="mr-2 h-4 w-4" />
            ) : (
              <Rows2 className="mr-2 h-4 w-4" />
            )}
            {spreadMode === 'single' ? 'Double Page' : 'Single Page'}
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onPrev}
              disabled={!isLoaded || currentSpread <= 0}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={onNext}
              disabled={!isLoaded || currentSpread >= totalSpreads - 1}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Font: {Math.round(fontScale * 100)}%
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
