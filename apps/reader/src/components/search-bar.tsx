import { useEffect } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { useReader } from '@/hooks/use-reader';

interface SearchBarProps {
  search: ReturnType<typeof useReader>['search'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchBar({ search, open, onOpenChange }: SearchBarProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [onOpenChange]);

  const count = search.results.length;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search for text in the book"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search in book..."
          value={search.query}
          onValueChange={search.setQuery}
        />
        <CommandList>
          <CommandEmpty>{search.query ? 'No results found.' : 'Type to search...'}</CommandEmpty>
          {count > 0 && (
            <CommandGroup
              heading={
                <div className="flex items-center justify-between">
                  <span>{count} results</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-xs tabular-nums">
                      {search.activeIndex + 1}/{count}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={search.prev}>
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={search.next}>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              }
            >
              {search.results.map((result, i) => (
                <CommandItem
                  key={`${String(result.pageIndex)}-${String(i)}`}
                  value={`result-${String(i)}`}
                  onSelect={() => {
                    search.goTo(i);
                    onOpenChange(false);
                  }}
                  className="flex items-center justify-between"
                >
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{result.context}</span>
                  <span className="text-xs text-muted-foreground">p.{result.pageIndex + 1}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
