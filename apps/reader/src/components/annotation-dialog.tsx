import { useEffect, useState } from 'react';
import type { Annotation } from 'rito/annotations';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ANNOTATION_COLORS } from '@/components/annotation-toolbar';
import type { useReader } from '@/hooks/use-reader';

interface Props {
  annotation: Annotation | null;
  annotations: ReturnType<typeof useReader>['annotations'];
  onClose: () => void;
}

export function AnnotationDialog({ annotation, annotations, onClose }: Props) {
  const [note, setNote] = useState('');
  const [color, setColor] = useState(ANNOTATION_COLORS[0].value as string);

  // Sync local state when a different annotation is opened
  useEffect(() => {
    if (annotation) {
      setNote(annotation.note ?? '');
      setColor(annotation.color ?? ANNOTATION_COLORS[0].value);
    }
  }, [annotation?.id]);  

  if (!annotation) return null;

  const handleSave = () => {
    const patch: { color: string; note?: string } = { color };
    if (note) patch.note = note;
    annotations.update(annotation.id, patch);
    onClose();
  };

  const handleDelete = () => {
    annotations.remove(annotation.id);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Annotation</DialogTitle>
          <DialogDescription>Edit highlight color, add a note, or delete.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Color</span>
            <div className="flex gap-1.5">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c.bg}
                  type="button"
                  onClick={() => {
                    setColor(c.value);
                  }}
                  className="h-7 w-7 rounded-full border-2 transition-all hover:scale-110"
                  style={{
                    backgroundColor: c.bg,
                    borderColor: color === c.value ? 'currentColor' : 'transparent',
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">Note</span>
            <Textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              placeholder="Add a note..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
