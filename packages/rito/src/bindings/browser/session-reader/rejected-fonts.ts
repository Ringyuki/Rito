import { scheduleSessionReaderRelayout } from './foreground';
import type { SessionReaderState } from './state';

/**
 * A publication face the browser refused to decode. The spreads that list
 * it paint its text with a fallback, which is not the face the layout
 * measured that text with: the engine is told, and the book is laid out
 * again without the face. A family is reported once.
 */
export function rejectSessionReaderFont(
  state: SessionReaderState,
  family: string,
  error: unknown,
): void {
  if (state.disposed || state.rejectedFontFamilies.has(family)) return;
  state.rejectedFontFamilies.add(family);
  state.logger.warn(`reader font "${family}" could not be decoded; laying out without it`, error);
  state.session.markFontFamiliesUnavailable([family]).catch((failure: unknown) => {
    if (!state.disposed) state.logger.warn('reader font could not be marked unavailable', failure);
  });
  // Opening lays out again itself once its first layout is committed.
  if (state.layoutGeneration > 0) scheduleSessionReaderRelayout(state, true);
}
