import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { useReader } from '@/hooks/use-reader';

interface Props {
  hover: ReturnType<typeof useReader>['annotations']['hover'];
}

export function AnnotationTooltip({ hover }: Props) {
  if (!hover) return null;
  return (
    <Tooltip open>
      <TooltipTrigger asChild>
        <div
          className="pointer-events-none fixed"
          style={{ top: hover.y, left: hover.x, width: 1, height: 1 }}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{hover.annotation.record.note ?? 'Click to edit'}</TooltipContent>
    </Tooltip>
  );
}
