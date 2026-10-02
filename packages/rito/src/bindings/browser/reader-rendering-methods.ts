import type { Reader } from '../../reader';
import { notifyBrowserReaderChapterLocalActiveSpread } from './chapter-local-preview/coordinator';
import { noteBrowserReaderSpreadShown } from './image-presence';
import { warmBrowserReaderFrameWindow } from './reader/frame-cache';
import type { BrowserReaderState } from './reader/types';
import {
  notifySpreadRendered,
  renderSpreadToBoundCanvas,
  renderSpreadToContext,
} from './rendering';

/** Public rendering methods whose active-spread notification coordinates preview ownership. */
export function browserReaderRenderingMethods(
  state: BrowserReaderState,
): Pick<Reader, 'renderSpread' | 'renderSpreadTo' | 'notifyActiveSpread'> {
  return {
    renderSpread(index, scale = 1) {
      noteBrowserReaderSpreadShown(state, index);
      renderSpreadToBoundCanvas(state, index, scale);
      void warmBrowserReaderFrameWindow(state, index);
    },
    renderSpreadTo(index, ctx) {
      return renderSpreadToContext(state, index, ctx);
    },
    notifyActiveSpread(index) {
      noteBrowserReaderSpreadShown(state, index);
      notifyBrowserReaderChapterLocalActiveSpread(state, index);
      notifySpreadRendered(state, index);
      void warmBrowserReaderFrameWindow(state, index);
    },
  };
}
