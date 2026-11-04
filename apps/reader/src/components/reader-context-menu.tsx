import { toast } from 'sonner';
import { useCallback, useMemo } from 'react';
import {
  Bug,
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
import { copyDebugReport } from '@/lib/debug-log';
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
  const selection = useMenuSelection(reader);
  const turns = menuTurns(reader);
  const hasSelection = selection.text.length > 0;
  const { inputRef, handleChange, openFilePicker } = useFileLoader(onFileLoad);

  const handleCopy = useCallback(() => {
    if (!selection.text) return;
    void navigator.clipboard.writeText(selection.text).catch(() => {
      // Clipboard access may be denied; swallow silently.
    });
    selection.clear();
  }, [selection]);

  const handleCopyDebugLog = useCallback(() => {
    void copyDebugReport().then((outcome) => {
      toast.success(outcome === 'copied' ? 'Debug log copied' : 'Debug log saved as a file', {
        description: 'Paste it into the bug report.',
      });
    });
  }, []);

  const handleSearchSelection = useCallback(() => {
    if (!selection.text) return;
    const text = selection.text;
    selection.clear();
    reader.search.setQuery(text);
    reader.setSearchOpen(true);
  }, [reader, selection]);

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
            <ContextMenuItem onSelect={selection.highlight}>
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

        <ContextMenuItem onSelect={turns.prev} disabled={!turns.canPrev}>
          <ChevronLeft className="h-4 w-4" />
          Previous Page
          <ContextMenuShortcut>{turns.prevKey}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={turns.next} disabled={!turns.canNext}>
          <ChevronRight className="h-4 w-4" />
          Next Page
          <ContextMenuShortcut>{turns.nextKey}</ContextMenuShortcut>
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

        <ContextMenuItem onSelect={handleCopyDebugLog} data-testid="reader-copy-debug-log">
          <Bug className="h-4 w-4" />
          Export Debug Log
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

/**
 * What is selected, the pages' or the scroll view's while the book is read
 * scrolled, and what the menu does with it.
 */
function useMenuSelection(reader: ReturnType<typeof useReader>) {
  const scrolled = reader.spreadMode === 'scrolled';
  const text = scrolled ? (reader.scroll.selection?.text ?? '') : reader.selection.text;
  const view = reader.scroll.controller;
  const { annotations, annotateScrollSelection } = reader;
  const pageSelection = reader.selection;
  const clear = useCallback(() => {
    if (scrolled) view?.clearSelection();
    else pageSelection.clear();
  }, [pageSelection, scrolled, view]);
  const highlight = useCallback(() => {
    const color = ANNOTATION_COLORS[0].value;
    if (scrolled) {
      void annotateScrollSelection('highlight', color);
      return;
    }
    if (!pageSelection.hasSelection) return;
    annotations.add({ kind: 'highlight', color }).catch((error: unknown) => {
      toast.error('Could not add the highlight', {
        description: error instanceof Error ? error.message : String(error),
      });
    });
    pageSelection.clear();
  }, [annotateScrollSelection, annotations, pageSelection, scrolled]);
  return useMemo(() => ({ text, clear, highlight }), [clear, highlight, text]);
}

/** A page back and on: a turn, or a page of the strip while the book is read scrolled. */
function menuTurns(reader: ReturnType<typeof useReader>) {
  if (reader.spreadMode === 'scrolled') {
    const view = reader.scroll.controller;
    const by = (direction: number) => () => {
      if (view) view.scrollBy(direction * view.pageLength, { animate: true });
    };
    return {
      prev: by(-1),
      next: by(1),
      canPrev: view !== null && reader.scroll.progress > 0,
      canNext: view !== null && reader.scroll.progress < 1,
      prevKey: 'PgUp',
      nextKey: 'PgDn',
    };
  }
  return {
    prev: reader.prevSpread,
    next: reader.nextSpread,
    canPrev: reader.isLoaded && reader.currentSpread > 0,
    canNext: reader.isLoaded && reader.currentSpread < reader.spreads.length - 1,
    prevKey: '←',
    nextKey: '→',
  };
}
