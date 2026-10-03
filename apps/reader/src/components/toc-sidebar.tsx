import type { TocEntry } from '@ritojs/core';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface TocSidebarProps {
  toc: readonly TocEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (entry: TocEntry) => void;
  /** The entry the reader resolves the current page to. */
  activeEntry: TocEntry | undefined;
}

export function TocSidebar({ toc, open, onOpenChange, onNavigate, activeEntry }: TocSidebarProps) {
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
                activeEntry={activeEntry}
              />
            )}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/** The same TOC entry: the reader resolves positions to entries of this table. */
function isEntryActive(entry: TocEntry, active: TocEntry | undefined): boolean {
  return active !== undefined && entry.href === active.href && entry.label === active.label;
}

function TocEntries({
  entries,
  depth,
  onNavigate,
  activeEntry,
}: {
  entries: readonly TocEntry[];
  depth: number;
  onNavigate: (entry: TocEntry) => void;
  activeEntry: TocEntry | undefined;
}) {
  return (
    <ul className="space-y-0.5">
      {entries.map((entry, i) => {
        const isActive = isEntryActive(entry, activeEntry);
        return (
          <li key={`${String(depth)}-${String(i)}`}>
            <button
              data-toc-href={entry.href}
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
                activeEntry={activeEntry}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
