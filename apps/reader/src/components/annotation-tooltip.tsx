import { useRef } from 'react';
import type { AnnotationRecord } from '@ritojs/kit';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  /** The annotation the mouse rests on and the tooltip's place (screen coordinates); null for none. */
  hover: {
    readonly annotation: { readonly record: AnnotationRecord };
    readonly x: number;
    readonly y: number;
  } | null;
}

export function AnnotationTooltip({ hover }: Props) {
  const staleRef = useRef(hover);
  if (hover) staleRef.current = hover;
  const display = hover ?? staleRef.current;
  // An emptied note is stored empty (see AnnotationDialog): there is none to show.
  const note = display?.annotation.record.note?.trim();

  return (
    <Tooltip open={hover !== null}>
      <TooltipTrigger asChild>
        <div
          className="pointer-events-none fixed"
          style={{ top: display?.y ?? 0, left: display?.x ?? 0, width: 1, height: 1 }}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{note ? note : 'Click to edit'}</TooltipContent>
    </Tooltip>
  );
}
