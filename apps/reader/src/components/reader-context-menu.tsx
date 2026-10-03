import { toast } from 'sonner';
import { useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Highlighter,
  List,
  Moon,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ANNOTATION_COLORS } from '@/components/annotation-toolbar';
import { FileActionsContextMenu } from '@/components/file-actions';
import { useFileLoader } from '@/hooks/use-file-loader';
import type { useReader } from '@/hooks/use-reader';

interface Props {
  reader: ReturnType<typeof useReader>;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenToc: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onLoadDemo: () => void;
  onLoadShardedDemo: () => void;
  onFileLoad: (data: ArrayBuffer) => void;
  children: React.ReactNode;
}

export function ReaderContextMenu({
  reader,
  theme,
  onToggleTheme,
  onOpenToc,
  onOpenSearch,
  onOpenSettings,
  onLoadDemo,
  onLoadShardedDemo,
  onFileLoad,
  children,
}: Props) {
  const hasSelection = reader.selection.hasSelection && reader.selection.text.length > 0;
  const canPrev = reader.isLoaded && reader.currentSpread > 0;
  const canNext = reader.isLoaded && reader.currentSpread < reader.spreads.length - 1;
  const { inputRef, handleChange, openFilePicker } = useFileLoader(onFileLoad);

  const handleCopy = useCallback(() => {
    if (!reader.selection.text) return;
    void navigator.clipboard.writeText(reader.selection.text).catch(() => {
      // Clipboard access may be denied; swallow silently.
    });
    reader.selection.clear();
  }, [reader.selection]);

  const handleHighlight = useCallback(() => {
    if (!reader.selection.hasSelection) return;
    reader.annotations
      .add({ kind: 'highlight', color: ANNOTATION_COLORS[0].value })
      .catch((error: unknown) => {
        toast.error('Could not add the highlight', {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    reader.selection.clear();
  }, [reader.annotations, reader.selection]);

  const handleSearchSelection = useCallback(() => {
    if (!reader.selection.text) return;
    const text = reader.selection.text;
    reader.selection.clear();
    reader.search.setQuery(text);
    reader.setSearchOpen(true);
  }, [reader]);

  return (
    <ContextMenu>
      <input ref={inputRef} type="file" accept=".epub" className="hidden" onChange={handleChange} />
      <ContextMenuTrigger data-testid="reader-context-trigger" className="relative flex flex-1">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {hasSelection && (
          <>
            <ContextMenuItem onSelect={handleCopy}>
              <Copy className="h-4 w-4" />
              Copy
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleHighlight}>
              <Highlighter className="h-4 w-4" />
              Highlight
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleSearchSelection}>
              <Search className="h-4 w-4" />
              Search in Book
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem onSelect={onOpenSearch} disabled={!reader.isLoaded}>
          <Search className="h-4 w-4" />
          Search
          <ContextMenuShortcut>⌘F</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenToc} disabled={!reader.isLoaded}>
          <List className="h-4 w-4" />
          Contents
        </ContextMenuItem>

        <ContextMenuItem
          onSelect={() => {
            reader.prevSpread();
          }}
          disabled={!canPrev}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous Page
          <ContextMenuShortcut>←</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            reader.nextSpread();
          }}
          disabled={!canNext}
        >
          <ChevronRight className="h-4 w-4" />
          Next Page
          <ContextMenuShortcut>→</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={onToggleTheme}>
          {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenSettings} disabled={!reader.isLoaded}>
          <Settings className="h-4 w-4" />
          Reader Settings
        </ContextMenuItem>

        <ContextMenuSeparator />

        <FileActionsContextMenu
          isLoading={reader.isLoading}
          onLoadDemo={onLoadDemo}
          onLoadShardedDemo={onLoadShardedDemo}
          onOpenFile={openFilePicker}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
