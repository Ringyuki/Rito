import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  current: number;
  total: number;
  onSeek: (index: number) => void;
  className?: string;
}

export function ProgressBar({ current, total, onSeek, className }: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const progress = total > 0 ? ((current + 1) / total) * 100 : 0;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar || total === 0) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const index = Math.round(ratio * (total - 1));
      onSeek(index);
    },
    [total, onSeek],
  );

  return (
    <div
      ref={barRef}
      className={cn('h-1 w-full bg-muted', total > 0 ? 'cursor-pointer' : '', className)}
      onClick={handleClick}
    >
      {total > 0 && (
        <div
          className="h-full bg-primary/40 transition-[width] duration-150"
          style={{ width: `${String(progress)}%` }}
        />
      )}
    </div>
  );
}
