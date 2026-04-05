import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Minus,
  Moon,
  Plus,
  Rows2,
  Search,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileActions } from '@/components/file-actions';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ToolbarProps {
  isLoaded: boolean;
  isLoading: boolean;
  currentSpread: number;
  totalSpreads: number;
  spreadMode: 'single' | 'double';
  bookTitle: string;
  theme: 'light' | 'dark';
  onLoadDemo: () => void;
  onFileLoad: (data: ArrayBuffer) => void;
  onPrev: () => void;
  onNext: () => void;
  fontScale: number;
  onToggleSpread: () => void;
  onToggleTheme: () => void;
  onToggleToc: () => void;
  onToggleSearch: () => void;
  onIncreaseFontSize: () => void;
  onDecreaseFontSize: () => void;
}

export function Toolbar({
  isLoaded,
  isLoading,
  currentSpread,
  totalSpreads,
  spreadMode,
  bookTitle,
  theme,
  onLoadDemo,
  onFileLoad,
  onPrev,
  onNext,
  fontScale,
  onToggleSpread,
  onToggleTheme,
  onToggleToc,
  onToggleSearch,
  onIncreaseFontSize,
  onDecreaseFontSize,
}: ToolbarProps) {
  return (
    <header className="flex shrink-0 h-14 items-center gap-2 border-b border-border bg-card px-4">
      {/* Left: File actions */}
      <div className="flex items-center gap-1.5">
        <FileActions
          isLoading={isLoading}
          onLoadDemo={onLoadDemo}
          onFileLoad={onFileLoad}
          size="sm"
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
        {isLoaded && bookTitle && (
          <span className="max-w-[200px] truncate text-sm font-medium">{bookTitle}</span>
        )}
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
            <Button variant="ghost" size="icon" onClick={onToggleSearch} disabled={!isLoaded}>
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search (Ctrl+F)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onToggleToc} disabled={!isLoaded}>
              <BookOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Table of contents</TooltipContent>
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
