import { useCallback, useEffect, useRef, useState } from 'react';
import { serializeFontFamilyName } from '@/lib/font-family-value';

export type SystemFontsStatus = 'unsupported' | 'idle' | 'loading' | 'loaded' | 'denied';

export interface SystemFontEntry {
  readonly family: string;
  readonly cssValue: string;
  readonly fullName: string;
  readonly style: string;
  readonly postscriptName: string;
  /** The face's bytes, for registering it with the reader. */
  readonly load: () => Promise<ArrayBuffer>;
}

interface FontData {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  blob(): Promise<Blob>;
}

type QueryLocalFonts = () => Promise<FontData[]>;

function getQueryFn(): QueryLocalFonts | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { queryLocalFonts?: QueryLocalFonts };
  return typeof host.queryLocalFonts === 'function' ? host.queryLocalFonts : null;
}

/**
 * The system's fonts through Local Font Access, one entry per family, named
 * as the platform names them. A font's bytes are read only when it is
 * chosen.
 */
export function useSystemFonts(): {
  fonts: readonly SystemFontEntry[];
  status: SystemFontsStatus;
  request: () => void;
} {
  const [fonts, setFonts] = useState<readonly SystemFontEntry[]>([]);
  const [status, setStatus] = useState<SystemFontsStatus>(() =>
    getQueryFn() === null ? 'unsupported' : 'idle',
  );
  const requestTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      requestTokenRef.current++;
    };
  }, []);

  const request = useCallback(() => {
    if (status !== 'idle') return;
    const query = getQueryFn();
    if (query === null) return;

    const token = ++requestTokenRef.current;
    setStatus('loading');
    void query()
      .then((data) => {
        if (requestTokenRef.current !== token) return;
        setFonts(sortEntries(pickFamilyRepresentatives(data).map(createEntry)));
        setStatus('loaded');
      })
      .catch(() => {
        if (requestTokenRef.current !== token) return;
        setStatus('denied');
      });
  }, [status]);

  return { fonts, status, request };
}

function createEntry(font: FontData): SystemFontEntry {
  return {
    load: async () => (await font.blob()).arrayBuffer(),
    family: font.family,
    cssValue: serializeFontFamilyName(font.family),
    fullName: font.fullName,
    style: font.style,
    postscriptName: font.postscriptName,
  };
}

function pickFamilyRepresentatives(fonts: readonly FontData[]): readonly FontData[] {
  const representatives = new Map<string, FontData>();

  for (const font of fonts) {
    const current = representatives.get(font.family);
    if (!current || scoreStyle(font.style) < scoreStyle(current.style)) {
      representatives.set(font.family, font);
    }
  }

  return [...representatives.values()];
}

function scoreStyle(style: string): number {
  const normalized = style.toLowerCase();
  if (normalized === 'regular') return 0;
  if (normalized === 'roman') return 1;
  if (normalized === 'book') return 2;
  if (normalized === 'medium') return 3;
  if (normalized.includes('regular')) return 4;
  if (normalized.includes('book')) return 5;
  if (normalized.includes('medium')) return 6;
  if (normalized.includes('semibold')) return 7;
  if (normalized.includes('bold')) return 8;
  if (normalized.includes('light')) return 9;
  return 20;
}

function sortEntries(entries: readonly SystemFontEntry[]): readonly SystemFontEntry[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...entries].sort((left, right) => collator.compare(left.family, right.family));
}
