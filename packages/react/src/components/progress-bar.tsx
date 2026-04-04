import { useCallback, useRef, useState } from 'react';
import type { ReaderController } from '@rito/kit';
import { useControllerEvent } from '../utils/use-controller-event';

export interface ProgressBarProps {
  readonly controller: ReaderController | null;
  readonly className?: string | undefined;
  readonly barClassName?: string | undefined;
}

export function ProgressBar({
  controller,
  className,
  barClassName,
}: ProgressBarProps): React.JSX.Element {
  const [spread, setSpread] = useState({ current: 0, total: 0 });
  const barRef = useRef<HTMLDivElement>(null);

  useControllerEvent(controller, 'spreadChange', ({ spreadIndex }) => {
    setSpread((s) => ({ ...s, current: spreadIndex }));
  });

  useControllerEvent(controller, 'layoutChange', ({ totalSpreads }) => {
    setSpread((s) => ({ ...s, total: totalSpreads }));
  });

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar || spread.total === 0 || !controller) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      controller.goToSpread(Math.round(ratio * (spread.total - 1)));
    },
    [controller, spread.total],
  );

  const progress = spread.total > 0 ? ((spread.current + 1) / spread.total) * 100 : 0;

  return (
    <div
      ref={barRef}
      className={className}
      style={
        className
          ? undefined
          : { height: 4, width: '100%', backgroundColor: '#e5e5e5', cursor: 'pointer' }
      }
      onClick={handleClick}
    >
      <div
        className={barClassName}
        style={{
          height: '100%',
          width: `${String(progress)}%`,
          backgroundColor: barClassName ? undefined : 'rgba(0,0,0,0.3)',
          transition: 'width 150ms',
        }}
      />
    </div>
  );
}
