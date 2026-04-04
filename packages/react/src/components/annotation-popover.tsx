import { useCallback } from 'react';
import type { ReaderController } from '@rito/kit';
import { useSelection } from '../hooks/use-selection';

export const DEFAULT_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6'] as const;

export interface AnnotationPopoverProps {
  readonly controller: ReaderController | null;
  readonly colors?: readonly string[] | undefined;
  readonly className?: string | undefined;
}

/**
 * Floating toolbar that appears above the selection.
 * Clicking a color creates a highlight annotation.
 */
export function AnnotationPopover({
  controller,
  colors = DEFAULT_COLORS,
  className,
}: AnnotationPopoverProps): React.JSX.Element | null {
  const { hasSelection, rects, clear } = useSelection(controller);

  const handleColorClick = useCallback(
    (color: string) => {
      if (!controller) return;
      const range = controller.selectionRange;
      if (!range) return;
      controller.addAnnotation({ type: 'highlight', range, color });
      clear();
    },
    [controller, clear],
  );

  if (!hasSelection || rects.length === 0) return null;

  const lastRect = rects[rects.length - 1];
  if (!lastRect) return null;

  const top = lastRect.y - 40;
  const left = lastRect.x + lastRect.width / 2;

  return (
    <div
      className={className}
      style={
        className
          ? { position: 'absolute', top, left, transform: 'translateX(-50%)' }
          : {
              ...defaultPopoverStyle,
              top,
              left,
              transform: 'translateX(-50%)',
            }
      }
    >
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => {
            handleColorClick(color);
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            backgroundColor: color,
            border: '2px solid transparent',
            cursor: 'pointer',
            padding: 0,
          }}
          aria-label={`Highlight ${color}`}
        />
      ))}
    </div>
  );
}

const defaultPopoverStyle: React.CSSProperties = {
  position: 'absolute',
  display: 'flex',
  gap: '0.375rem',
  padding: '0.375rem 0.5rem',
  backgroundColor: '#fff',
  border: '1px solid #e5e5e5',
  borderRadius: '0.5rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  zIndex: 10,
};
