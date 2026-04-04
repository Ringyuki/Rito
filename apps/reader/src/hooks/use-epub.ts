import { getActiveChapterHref, getCanvasSize } from './epub-shared';
import type { ContainerSize } from './use-container-size';
import { useEpubController } from './use-epub-controller';
import { useEpubNavigation } from './use-epub-navigation';

export function useEpub(containerSize: ContainerSize, theme: 'light' | 'dark') {
  const { canvasRef, readerRef, state, setState, draw, loadFromArrayBuffer, loadDemo } =
    useEpubController(containerSize, theme);
  const navigation = useEpubNavigation({ readerRef, setState, draw });
  const reader = readerRef.current;

  return {
    ...state,
    canvasRef,
    canvasSize: getCanvasSize(containerSize, state.fontScale),
    bookTitle: reader?.metadata.title,
    activeChapterHref: getActiveChapterHref(reader, state.spreads, state.currentSpread),
    loadFromArrayBuffer,
    loadDemo,
    ...navigation,
  };
}
