import { useRef } from 'react';
import type { ReaderControllerEvents } from '@rito/kit';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BookOpen, ExternalLink } from 'lucide-react';

interface Props {
  link: ReaderControllerEvents['linkClick'] | null;
  onClose: () => void;
}

export function LinkDialog({ link, onClose }: Props) {
  // Keep last non-null value so content stays visible during close animation
  const staleRef = useRef(link);
  if (link) staleRef.current = link;
  const display = link ?? staleRef.current;

  const isExternal = display?.type === 'external';

  const handleNavigate = () => {
    display?.navigate();
    onClose();
  };

  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isExternal ? (
              <>
                <ExternalLink className="h-4 w-4" />
                Open External Link
              </>
            ) : (
              <>
                <BookOpen className="h-4 w-4" />
                Navigate to Chapter
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isExternal
              ? 'You are about to leave the reader.'
              : 'Jump to another section of this book.'}
          </DialogDescription>
        </DialogHeader>

        {isExternal ? (
          <p className="truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">{display.href}</p>
        ) : (
          display?.resolvedLabel && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium">
              {display.resolvedLabel}
            </p>
          )
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleNavigate}>
            {isExternal ? 'Open' : 'Go'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
