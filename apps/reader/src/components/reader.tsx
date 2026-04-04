import { Loader2 } from 'lucide-react';
import { Reader as RitoReader } from '@rito/react';
import { Placeholder } from '@/components/placeholder';
import { type useReader } from '@/hooks/use-reader';

interface ReaderProps {
  containerRef: (node: HTMLElement | null) => void;
  reader: ReturnType<typeof useReader>;
}

export function Reader({ containerRef, reader }: ReaderProps) {
  return (
    <main ref={containerRef} className="relative flex flex-1 bg-muted/30">
      {reader.isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading...</p>
        </div>
      )}

      {!reader.isLoaded && !reader.isLoading && !reader.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <p className="text-lg">Open an EPUB to start reading</p>
          <p className="text-sm">Use the toolbar to load a demo or open a file</p>
        </div>
      )}

      {reader.error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {reader.error}
          </div>
        </div>
      )}

      <RitoReader
        controller={reader.controller}
        className="flex flex-1 items-center justify-center"
        placeholder={<Placeholder />}
      />
    </main>
  );
}
