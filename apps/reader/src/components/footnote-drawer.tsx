import type { ReaderControllerEvents } from '@ritojs/kit';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';

interface Props {
  footnote: ReaderControllerEvents['footnoteClick'] | null;
  onClose: () => void;
}

export function FootnoteDrawer({ footnote, onClose }: Props) {
  return (
    <Drawer
      open={footnote !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Footnote</DrawerTitle>
          <DrawerDescription className="sr-only">Footnote content</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-6 text-sm leading-relaxed">
          {footnote?.content.html ? (
            <div dangerouslySetInnerHTML={{ __html: footnote.content.html }} />
          ) : (
            <p>{footnote?.content.text}</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
