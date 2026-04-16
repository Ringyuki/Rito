import type { TocEntry } from '@rito/core';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface TocSidebarProps {
  toc: readonly TocEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (entry: TocEntry) => void;
  activeChapterHref: string;
}

export function TocSidebar({
  toc,
  open,
  onOpenChange,
  onNavigate,
  activeChapterHref,
}: TocSidebarProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Contents</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-5rem)]">
          <nav className="p-2">
            {toc.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No table of contents</p>
            ) : (
              <TocEntries
                entries={toc}
                depth={0}
                onNavigate={onNavigate}
                activeChapterHref={activeChapterHref}
              />
            )}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/** Check if a TOC entry href matches the active chapter href. */
function isEntryActive(entryHref: string, activeHref: string): boolean {
  if (!activeHref) return false;
  // Strip fragment
  const entryPath = entryHref.split('#')[0] ?? '';
  // Match by filename (TOC hrefs are relative, may have different prefixes)
  const entryFile = entryPath.split('/').pop() ?? '';
  const activeFile = activeHref.split('/').pop() ?? '';
  return entryFile !== '' && entryFile === activeFile;
}

function TocEntries({
  entries,
  depth,
  onNavigate,
  activeChapterHref,
}: {
  entries: readonly TocEntry[];
  depth: number;
  onNavigate: (entry: TocEntry) => void;
  activeChapterHref: string;
}) {
  return (
    <ul className="space-y-0.5">
      {entries.map((entry, i) => {
        const isActive = isEntryActive(entry.href, activeChapterHref);
        return (
          <li key={`${String(depth)}-${String(i)}`}>
            <button
              className={cn(
                'w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-foreground/70 hover:bg-accent hover:text-accent-foreground',
              )}
              style={{ paddingLeft: `${String(12 + depth * 16)}px` }}
              onClick={() => {
                onNavigate(entry);
              }}
            >
              {entry.label}
            </button>
            {entry.children.length > 0 && (
              <TocEntries
                entries={entry.children}
                depth={depth + 1}
                onNavigate={onNavigate}
                activeChapterHref={activeChapterHref}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
