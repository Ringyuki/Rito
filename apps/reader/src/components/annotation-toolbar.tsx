import { useState } from 'react';
import { MessageSquarePlus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { useReader } from '@/hooks/use-reader';
import { Input } from '@/components/ui/input';

export const ANNOTATION_COLORS = [
  { value: 'rgba(250, 204, 21, 0.35)', bg: '#facc15' },
  { value: 'rgba(74, 222, 128, 0.35)', bg: '#4ade80' },
  { value: 'rgba(96, 165, 250, 0.35)', bg: '#60a5fa' },
  { value: 'rgba(244, 114, 182, 0.35)', bg: '#f472b6' },
] as const;

interface Props {
  selection: ReturnType<typeof useReader>['selection'];
  annotations: ReturnType<typeof useReader>['annotations'];
  controller: ReturnType<typeof useReader>['controller'];
  renderScale: number;
}

function stop(e: React.SyntheticEvent): void {
  e.stopPropagation();
  e.nativeEvent.stopImmediatePropagation();
}

export function AnnotationToolbar({ selection, annotations, controller, renderScale }: Props) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [pickedColor, setPickedColor] = useState(ANNOTATION_COLORS[0].value as string);

  if (!selection.hasSelection || !selection.focusRect || !selection.text) {
    return null;
  }

  const anchor = selection.focusRect;

  // focusRect is a zero-width caret at the exact focus endpoint — multiply by renderScale
  const top = anchor.y * renderScale - (showNote ? 110 : 60);
  const left = anchor.x * renderScale;

  const submit = (color: string, noteText?: string) => {
    if (!controller || !selection.range) return;
    annotations.add({
      kind: 'highlight',
      color,
      ...(noteText ? { note: noteText } : {}),
    });
    controller.clearSelection();
    setShowNote(false);
    setNote('');
  };

  return (
    <div
      className="absolute z-30 flex flex-col gap-1.5 rounded-lg border border-border bg-popover p-1.5 shadow-lg animate-in fade-in zoom-in-95 duration-150"
      style={{ top, left, transform: 'translateX(-50%)', minWidth: showNote ? 220 : undefined }}
      onPointerDown={stop}
      onPointerUp={stop}
    >
      <div className="flex items-center gap-1">
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c.bg}
            type="button"
            onClick={() => {
              if (showNote) {
                setPickedColor(c.value);
              } else {
                submit(c.value);
              }
            }}
            className="h-6 w-6 rounded-full border-2 transition-all hover:scale-110"
            style={{
              backgroundColor: c.bg,
              borderColor: showNote && pickedColor === c.value ? 'currentColor' : 'transparent',
            }}
          />
        ))}
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Button
          variant={showNote ? 'secondary' : 'ghost'}
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            setShowNote(!showNote);
          }}
          title="Add note"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {showNote && (
        <div className="flex gap-1">
          <Input
            type="text"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(pickedColor, note);
            }}
            placeholder="Add a note..."
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <Button
            size="icon"
            className="h-8 w-8"
            variant="outline"
            onClick={() => {
              submit(pickedColor, note);
            }}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
