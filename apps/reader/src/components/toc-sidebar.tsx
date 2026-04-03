import type { TocEntry } from 'rito';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface TocSidebarProps {
  toc: readonly TocEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (entry: TocEntry) => void;
}

export function TocSidebar({ toc, open, onOpenChange, onNavigate }: TocSidebarProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="text-sm">Contents</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100%-3rem)]">
          <nav className="p-2">
            {toc.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No table of contents</p>
            ) : (
              <TocEntries entries={toc} depth={0} onNavigate={onNavigate} />
            )}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function TocEntries({
  entries,
  depth,
  onNavigate,
}: {
  entries: readonly TocEntry[];
  depth: number;
  onNavigate: (entry: TocEntry) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {entries.map((entry, i) => (
        <li key={`${String(depth)}-${String(i)}`}>
          <button
            className={cn(
              'w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors',
              'text-foreground/70 hover:bg-accent hover:text-accent-foreground',
            )}
            style={{ paddingLeft: `${String(12 + depth * 16)}px` }}
            onClick={() => {
              onNavigate(entry);
            }}
          >
            {entry.label}
          </button>
          {entry.children.length > 0 && (
            <TocEntries entries={entry.children} depth={depth + 1} onNavigate={onNavigate} />
          )}
        </li>
      ))}
    </ul>
  );
}
