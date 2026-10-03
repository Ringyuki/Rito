import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ReaderFontCatalog, ReaderHostFontFace } from '@ritojs/core';
import type { ReaderController } from '@ritojs/kit';
import { useControllerEvent } from '@ritojs/react';
import { serializeFontFamilyName } from '@/lib/font-family-value';

type GenericRole = ReaderHostFontFace['genericRole'];

export interface ReaderFonts {
  /** Every family a font-family choice can name in the open book; null before a book opens. */
  readonly catalog: ReaderFontCatalog | null;
  /**
   * Registers a font's bytes with the reader (a system font, an imported
   * file) and resolves to the `font-family` value that names it, or null
   * when the reader refused the face.
   */
  readonly addFont: (bytes: ArrayBuffer, fallbackName: string) => Promise<string | null>;
  /** Removes a face the reader added; the generics keep resolving as before. */
  readonly removeFont: (sha256: string) => Promise<void>;
  /** SHA-256 of the faces added in this session, the ones a reader may remove. */
  readonly added: ReadonlySet<string>;
}

/**
 * The open book's fonts: the catalog font choices are built from, and the
 * faces a reader adds or removes. A `font-family` choice no face answers
 * to reaches the reader as a non-fatal `error` event and shows as a toast.
 */
export function useReaderFonts(controller: ReaderController | null, loaded: boolean): ReaderFonts {
  const [catalog, setCatalog] = useState<ReaderFontCatalog | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!controller) return;
    setCatalog(await controller.fonts());
  }, [controller]);

  useEffect(() => {
    setCatalog(null);
    setAdded(new Set());
    if (!loaded) return;
    refresh().catch((error: unknown) => {
      toast.error('Fonts unavailable', { description: describe(error) });
    });
  }, [loaded, refresh]);

  useControllerEvent(controller, 'error', ({ message, source }) => {
    if (source === 'font-family') toast.warning('Font not available', { description: message });
  });

  const addFont = useCallback(
    async (bytes: ArrayBuffer, fallbackName: string): Promise<string | null> => {
      if (!controller) return null;
      const expectedSha256 = await sha256Hex(bytes);
      const role = guessRole(fallbackName);
      try {
        await controller.addFontFaces([{ bytes, expectedSha256, genericRole: role }]);
      } catch (error) {
        // A face already added is simply chosen again.
        if (!describe(error).includes('already registered')) {
          toast.error(`Could not add ${fallbackName}`, { description: describe(error) });
          return null;
        }
      }
      setAdded((current) => new Set(current).add(expectedSha256));
      const next = await controller.fonts();
      setCatalog(next);
      const family = next.families.find((candidate) =>
        candidate.faces.some((face) => face.sha256 === expectedSha256),
      );
      return fontFamilyValue(family?.name ?? fallbackName, family?.genericRole ?? role);
    },
    [controller],
  );

  const removeFont = useCallback(
    async (sha256: string) => {
      if (!controller) return;
      try {
        await controller.removeFontFaces([sha256]);
        setAdded((current) => {
          const next = new Set(current);
          next.delete(sha256);
          return next;
        });
        await refresh();
      } catch (error) {
        toast.error('Could not remove the font', { description: describe(error) });
      }
    },
    [controller, refresh],
  );

  return { catalog, addFont, removeFont, added };
}

/**
 * The `font-family` value that names a family: the family itself, then the
 * generic of its role so characters it lacks fall to a face of the same
 * kind.
 */
export function fontFamilyValue(name: string, role: GenericRole | null): string {
  const generic =
    role === 'sansSerif' ? 'sans-serif' : role === 'monospace' ? 'monospace' : 'serif';
  return `${serializeFontFamilyName(name)}, ${generic}`;
}

/**
 * The generic family a system or imported font most likely serves, from
 * its name. It only orders the fallback after the font itself, so a wrong
 * guess never changes the chosen font.
 */
function guessRole(name: string): GenericRole {
  if (/mono|code|courier|consol|menlo|terminal/i.test(name)) return 'monospace';
  if (/sans|gothic|grotesk|hei|黑|arial|helvetica|verdana|segoe|pingfang|yahei/i.test(name)) {
    return 'sansSerif';
  }
  return 'serif';
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
