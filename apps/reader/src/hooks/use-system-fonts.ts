import { useCallback, useEffect, useRef, useState } from 'react';
import { serializeFontFamilyName } from '@/lib/font-family-value';
import { parseLocalizedFontNames, type LocalizedFontName } from '@/lib/local-font-name-table';

export type SystemFontsStatus = 'unsupported' | 'idle' | 'loading' | 'loaded' | 'denied';

export interface SystemFontEntry {
  readonly family: string;
  readonly cssValue: string;
  readonly fullName: string;
  readonly style: string;
  readonly postscriptName: string;
  readonly displayName: string;
  readonly secondaryName?: string;
  readonly displayLang?: string;
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
      .then(async (data) => {
        if (requestTokenRef.current !== token) return;

        const representatives = pickFamilyRepresentatives(data);
        const basicEntries = sortEntries(representatives.map(createBasicEntry));
        setFonts(basicEntries);
        setStatus('loaded');

        const locales = getPreferredLocales();
        const enriched = await mapWithConcurrencyLimit(representatives, 3, async (font) =>
          resolveLocalizedEntry(font, locales),
        );
        if (requestTokenRef.current !== token) return;
        setFonts(sortEntries(enriched));
      })
      .catch(() => {
        if (requestTokenRef.current !== token) return;
        setStatus('denied');
      });
  }, [status]);

  return { fonts, status, request };
}

async function resolveLocalizedEntry(
  font: FontData,
  preferredLocales: readonly string[],
): Promise<SystemFontEntry> {
  const fallback = createBasicEntry(font);

  try {
    const blob = await font.blob();
    const buffer = await blob.arrayBuffer();
    const parsed = parseLocalizedFontNames(buffer, {
      family: font.family,
      fullName: font.fullName,
      postscriptName: font.postscriptName,
    });
    if (!parsed) return fallback;

    const chosen =
      chooseLocalizedName(parsed.familyNames, preferredLocales) ??
      chooseLocalizedName(parsed.fullNames, preferredLocales);
    if (!chosen) return fallback;

    const secondaryName =
      !sameText(chosen.value, font.family) && !sameText(chosen.value, fallback.displayName)
        ? font.family
        : undefined;

    return {
      ...fallback,
      displayName: chosen.value,
      ...(secondaryName ? { secondaryName } : {}),
      ...(chosen.lang ? { displayLang: chosen.lang } : {}),
    };
  } catch {
    return fallback;
  }
}

function createBasicEntry(font: FontData): SystemFontEntry {
  return {
    family: font.family,
    cssValue: serializeFontFamilyName(font.family),
    fullName: font.fullName,
    style: font.style,
    postscriptName: font.postscriptName,
    displayName: font.family,
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

function chooseLocalizedName(
  names: readonly LocalizedFontName[],
  preferredLocales: readonly string[],
): LocalizedFontName | undefined {
  let best: { readonly name: LocalizedFontName; readonly score: number } | undefined;

  for (const name of names) {
    const { matchedLocale, score } = scoreLocalizedName(name, preferredLocales);
    if (!matchedLocale) continue;
    if (!best || score > best.score) {
      best = { name, score };
    }
  }

  return best?.name;
}

function scoreLocalizedName(
  name: LocalizedFontName,
  preferredLocales: readonly string[],
): {
  readonly matchedLocale: boolean;
  readonly score: number;
} {
  const priority = name.nameId === 16 ? 20 : name.nameId === 1 ? 10 : 0;
  if (!name.lang) return { matchedLocale: false, score: priority };

  const candidate = parseLocale(name.lang);
  for (let index = 0; index < preferredLocales.length; index++) {
    const preferred = parseLocale(preferredLocales[index] ?? '');
    const distance = preferredLocales.length - index;

    if (candidate.baseName === preferred.baseName) {
      return { matchedLocale: true, score: priority + 1000 + distance };
    }
    if (
      candidate.language === preferred.language &&
      candidate.script !== undefined &&
      candidate.script === preferred.script
    ) {
      return { matchedLocale: true, score: priority + 900 + distance };
    }
    if (candidate.language === preferred.language) {
      return { matchedLocale: true, score: priority + 800 + distance };
    }
  }

  return { matchedLocale: false, score: priority };
}

function getPreferredLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return ['en-US', 'en'];

  const locales = new Set<string>();
  for (const locale of navigator.languages) {
    const normalized = normalizeLocale(locale);
    if (normalized) locales.add(normalized);
  }

  const primary = normalizeLocale(navigator.language);
  if (primary) locales.add(primary);
  locales.add('en-US');
  locales.add('en');
  return [...locales];
}

function normalizeLocale(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new Intl.Locale(value).baseName;
  } catch {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}

function parseLocale(value: string): {
  readonly baseName: string;
  readonly language: string;
  readonly script?: string;
} {
  try {
    const locale = new Intl.Locale(value).maximize();
    return {
      baseName: locale.baseName,
      language: locale.language,
      ...(locale.script ? { script: locale.script } : {}),
    };
  } catch {
    const [language, script] = value.split('-');
    return {
      baseName: value,
      language: language?.toLowerCase() ?? value.toLowerCase(),
      ...(script && script.length === 4 ? { script } : {}),
    };
  }
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function sortEntries(entries: readonly SystemFontEntry[]): readonly SystemFontEntry[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...entries].sort((left, right) => collator.compare(left.displayName, right.displayName));
}

async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R | undefined>(items.length);
  const iterator = items.entries();

  const takeNext = (): readonly [number, T] | null => {
    const next = iterator.next();
    return next.done ? null : next.value;
  };

  const worker = async () => {
    for (let next = takeNext(); next !== null; next = takeNext()) {
      const [index, item] = next;
      results[index] = await mapper(item);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results.filter((result): result is R => result !== undefined);
}
