import { useRef } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { useReader } from '@/hooks/use-reader';

interface Props {
  hover: ReturnType<typeof useReader>['annotations']['hover'];
}

export function AnnotationTooltip({ hover }: Props) {
  const staleRef = useRef(hover);
  if (hover) staleRef.current = hover;
  const display = hover ?? staleRef.current;

  return (
    <Tooltip open={hover !== null}>
      <TooltipTrigger asChild>
        <div
          className="pointer-events-none fixed"
          style={{ top: display?.y ?? 0, left: display?.x ?? 0, width: 1, height: 1 }}
        />
      </TooltipTrigger>
      <TooltipContent side="top">
        {display?.annotation.record.note ?? 'Click to edit'}
      </TooltipContent>
    </Tooltip>
  );
}
