import { BookOpen, FileUp, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileLoader } from '@/hooks/use-file-loader';
import { ContextMenuItem } from '@/components/ui/context-menu';

interface FileActionsProps {
  isLoading?: boolean;
  onLoadDemo: () => void;
  /** Opens the demo book split by `rito-pack`, fetched a shard at a time. */
  onLoadShardedDemo: () => void;
  onFileLoad: (data: ArrayBuffer) => void;
  size?: 'default' | 'sm';
  variant?: 'outline' | 'default' | 'ghost' | 'secondary';
  demoLabel?: string;
  openLabel?: string;
  className?: string;
}

export function FileActions({
  isLoading,
  onLoadDemo,
  onLoadShardedDemo,
  onFileLoad,
  size = 'default',
  variant = 'outline',
  demoLabel = 'Demo',
  openLabel = 'Open',
  className,
}: FileActionsProps) {
  const { inputRef, handleChange, openFilePicker } = useFileLoader(onFileLoad);

  return (
    <>
      <Button
        data-testid="load-demo-button"
        variant={variant}
        size={size}
        className={className}
        onClick={onLoadDemo}
        disabled={isLoading}
      >
        <BookOpen className="mr-1.5 h-4 w-4" />
        {demoLabel}
      </Button>
      <Button
        data-testid="load-sharded-demo-button"
        variant={variant}
        size={size}
        className={className}
        onClick={onLoadShardedDemo}
        disabled={isLoading}
        title="The demo book split by rito-pack: opens from its skeleton, images arrive as shards"
      >
        <Layers className="mr-1.5 h-4 w-4" />
        Sharded demo
      </Button>
      <Button
        data-testid="open-file-button"
        variant={variant}
        size={size}
        className={className}
        onClick={openFilePicker}
        disabled={isLoading}
      >
        <FileUp className="mr-1.5 h-4 w-4" />
        {openLabel}
      </Button>
      <input ref={inputRef} type="file" accept=".epub" className="hidden" onChange={handleChange} />
    </>
  );
}

export function FileActionsContextMenu({
  isLoading,
  onLoadDemo,
  onLoadShardedDemo,
  onOpenFile,
  demoLabel = 'Load Demo',
  openLabel = 'Open File',
}: {
  isLoading?: boolean;
  onLoadDemo: () => void;
  onLoadShardedDemo: () => void;
  onOpenFile: () => void;
  demoLabel?: string;
  openLabel?: string;
}) {
  return (
    <>
      <ContextMenuItem onSelect={onLoadDemo} disabled={isLoading ?? false}>
        <BookOpen className="h-4 w-4" />
        {demoLabel}
      </ContextMenuItem>
      <ContextMenuItem onSelect={onLoadShardedDemo} disabled={isLoading ?? false}>
        <Layers className="h-4 w-4" />
        Sharded Demo
      </ContextMenuItem>
      <ContextMenuItem onSelect={onOpenFile} disabled={isLoading ?? false}>
        <FileUp className="h-4 w-4" />
        {openLabel}
      </ContextMenuItem>
    </>
  );
}
