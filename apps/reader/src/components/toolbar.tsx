import { useRef } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileUp,
  Minus,
  Moon,
  Plus,
  Rows2,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ToolbarProps {
  isLoaded: boolean;
  isLoading: boolean;
  currentSpread: number;
  totalSpreads: number;
  spreadMode: 'single' | 'double';
  theme: 'light' | 'dark';
  onLoadDemo: () => void;
  onFileLoad: (data: ArrayBuffer, name: string) => void;
  onPrev: () => void;
  onNext: () => void;
  fontScale: number;
  onToggleSpread: () => void;
  onToggleTheme: () => void;
  onToggleToc: () => void;
  onIncreaseFontSize: () => void;
  onDecreaseFontSize: () => void;
}

export function Toolbar({
  isLoaded,
  isLoading,
  currentSpread,
  totalSpreads,
  spreadMode,
  theme,
  onLoadDemo,
  onFileLoad,
  onPrev,
  onNext,
  fontScale,
  onToggleSpread,
  onToggleTheme,
  onToggleToc,
  onIncreaseFontSize,
  onDecreaseFontSize,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        onFileLoad(reader.result, file.name);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <header className="flex h-14 items-center gap-2 border-b border-border bg-card px-4">
      {/* Left: File actions */}
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={onLoadDemo} disabled={isLoading}>
              <BookOpen className="mr-1.5 h-4 w-4" />
              Demo
            </Button>
          </TooltipTrigger>
          <TooltipContent>Load demo EPUB</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              <FileUp className="mr-1.5 h-4 w-4" />
              Open
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open EPUB file</TooltipContent>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      <Separator orientation="vertical" className="mx-1" />

      {/* Center: Navigation */}
      <div className="flex flex-1 items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrev}
          disabled={!isLoaded || currentSpread === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[120px] text-center text-sm text-muted-foreground">
          {isLoading
            ? 'Loading...'
            : isLoaded
              ? `${spreadMode === 'single' ? 'Page' : 'Spread'} ${String(currentSpread + 1)} / ${String(totalSpreads)}`
              : 'No document'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!isLoaded || currentSpread >= totalSpreads - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="mx-1" />

      {/* Right: View controls */}
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onToggleToc} disabled={!isLoaded}>
              <BookOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle table of contents</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onDecreaseFontSize} disabled={!isLoaded}>
              <Minus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Decrease font size</TooltipContent>
        </Tooltip>

        <span className="min-w-[3ch] text-center text-xs text-muted-foreground">
          {Math.round(fontScale * 100)}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onIncreaseFontSize} disabled={!isLoaded}>
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Increase font size</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onToggleSpread} disabled={!isLoaded}>
              {spreadMode === 'single' ? (
                <Rows2 className="h-4 w-4" />
              ) : (
                <Columns2 className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {spreadMode === 'single' ? 'Switch to double page' : 'Switch to single page'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onToggleTheme}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{theme === 'light' ? 'Dark mode' : 'Light mode'}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
