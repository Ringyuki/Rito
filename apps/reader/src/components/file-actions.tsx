import { BookOpen, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileLoader } from '@/hooks/use-file-loader';

interface FileActionsProps {
  isLoading?: boolean;
  onLoadDemo: () => void;
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
