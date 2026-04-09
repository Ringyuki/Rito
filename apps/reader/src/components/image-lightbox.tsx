import { useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReaderControllerEvents } from '@rito/kit';

interface Props {
  image: ReaderControllerEvents['imageClick'] | null;
  onClose: () => void;
}

export function ImageLightbox({ image, onClose }: Props) {
  const prevBlobUrl = useRef<string | undefined>(undefined);

  // Revoke old blob URL when image changes or on unmount
  useEffect(() => {
    if (prevBlobUrl.current && prevBlobUrl.current !== image?.blobUrl) {
      URL.revokeObjectURL(prevBlobUrl.current);
    }
    prevBlobUrl.current = image?.blobUrl;
    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    };
  }, [image?.blobUrl]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const sb = image?.screenBounds;

  return (
    <AnimatePresence>
      {image?.blobUrl && sb && (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ backgroundColor: 'rgba(0,0,0,0)' }}
          animate={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
          exit={{ backgroundColor: 'rgba(0,0,0,0)' }}
          transition={{ duration: 0.3 }}
          onClick={handleClose}
        >
          <motion.img
            src={image.blobUrl}
            alt={image.alt}
            className="absolute rounded-lg object-contain"
            style={{ willChange: 'transform' }}
            initial={{
              top: sb.y,
              left: sb.x,
              width: sb.width,
              height: sb.height,
            }}
            animate={{
              top: '5vh',
              left: '5vw',
              width: '90vw',
              height: '90vh',
            }}
            exit={{
              top: sb.y,
              left: sb.x,
              width: sb.width,
              height: sb.height,
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
