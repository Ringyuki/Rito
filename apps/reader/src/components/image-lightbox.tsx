import { useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReaderControllerEvents } from '@rito/kit';

interface Props {
  image: ReaderControllerEvents['imageClick'] | null;
  onClose: () => void;
  onExitComplete?: () => void;
}

export function ImageLightbox({ image, onClose, onExitComplete }: Props) {
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const sb = image?.screenBounds;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose]);

  return (
    <AnimatePresence {...(onExitComplete && { onExitComplete })}>
      {image?.blobUrl && sb && (
        <motion.div
          role="dialog"
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
