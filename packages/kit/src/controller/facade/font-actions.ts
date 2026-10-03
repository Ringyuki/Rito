import type { ReaderFontCatalog, ReaderHostFontFace } from '@ritojs/core';
import type { Emitter, FontActionsSlice, Internals } from './types';

/**
 * The reader's fonts through the controller. A face added or removed lays
 * the book out again; the commit reaches the controller the way every
 * reflow does, so it repaints with the current position kept.
 */
export function buildFontActions(internals: Internals): FontActionsSlice {
  return {
    fonts(): Promise<ReaderFontCatalog> {
      return requireFonts(internals, 'fonts')();
    },
    addFontFaces(faces: readonly ReaderHostFontFace[]): Promise<void> {
      return requireFonts(internals, 'addFontFaces')(faces);
    },
    removeFontFaces(sha256s: readonly string[]): Promise<void> {
      return requireFonts(internals, 'removeFontFaces')(sha256s);
    },
    async unresolvedFontFamilies(familyList: string): Promise<readonly string[]> {
      return requireFonts(internals, 'unresolvedFontFamilies')(familyList);
    },
  };
}

/**
 * Reports, as a non-fatal `error` event with source `font-family`, the
 * names in a reader's `font-family` choice that no face answers to. Layout
 * skips them the way a browser skips an uninstalled font, so the choice
 * still applies; the report is what keeps a typo from failing silently.
 */
export function reportUnresolvedFontFamilies(
  internals: Internals,
  emitter: Emitter,
  familyList: string,
): void {
  const check = internals.reader.unresolvedFontFamilies?.bind(internals.reader);
  if (!check) return;
  void check(familyList).then(
    (names) => {
      if (names.length === 0) return;
      emitter.emit('error', {
        message: `No face answers to ${names.map((name) => `"${name}"`).join(', ')}`,
        source: 'font-family',
      });
    },
    (error: unknown) => {
      emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: 'font-family',
      });
    },
  );
}

function requireFonts<
  K extends 'fonts' | 'addFontFaces' | 'removeFontFaces' | 'unresolvedFontFamilies',
>(internals: Internals, method: K): NonNullable<Internals['reader'][K]> {
  const bound = internals.reader[method]?.bind(internals.reader);
  if (!bound) throw new Error(`This reader does not support ${method}`);
  return bound as NonNullable<Internals['reader'][K]>;
}
