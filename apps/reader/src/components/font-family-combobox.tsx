import { useRef, useState } from 'react';
import { ChevronsUpDown, FileUp, Loader2, X } from 'lucide-react';
import type { ReaderFontFamily } from '@ritojs/core';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useSystemFonts, type SystemFontEntry } from '@/hooks/use-system-fonts';
import { fontFamilyValue, type ReaderFonts } from '@/hooks/use-reader-fonts';
import { cn } from '@/lib/utils';
import { getFontPreviewSpec, type FontPreviewSpec } from '@/lib/font-preview';
import { getFontFamilyDisplayName, serializeFontFamilyName } from '@/lib/font-family-value';

interface FontFamilyComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  fonts: ReaderFonts;
}

interface FontChoice {
  readonly key: string;
  readonly label: string;
  readonly value: string | null;
  /** The CSS family the option previews in; the page registers it. */
  readonly previewFamily: string | null;
  /** A face added in this session, which the reader may remove. */
  readonly removable?: string;
}

/**
 * The generics resolve to the reader's own faces of that role: the pinned
 * Tinos / Source Han Serif pair for serif, Arimo / Source Han Sans for
 * sans-serif. "Book default" leaves the book's own families in charge.
 */
const GENERIC_CHOICES: readonly FontChoice[] = [
  { key: 'book', label: 'Book default', value: null, previewFamily: null },
  { key: 'serif', label: 'Serif', value: 'serif', previewFamily: 'serif' },
  { key: 'sans', label: 'Sans-serif', value: 'sans-serif', previewFamily: 'sans-serif' },
  { key: 'mono', label: 'Monospace', value: 'monospace', previewFamily: 'monospace' },
];

/**
 * A font picker built from the open book's font catalog: the generics, the
 * reader's faces, the book's own faces, and fonts a reader adds — a system
 * font (Local Font Access) or an imported file — whose bytes are registered
 * with the reader before the choice applies.
 */
export function FontFamilyCombobox({ value, onChange, fonts }: FontFamilyComboboxProps) {
  const system = useSystemFonts();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const families = fonts.catalog?.families ?? [];
  const readerChoices = families
    .filter((family) => family.source === 'host')
    .map((family) => hostChoice(family, fonts.added));
  const bookChoices = families
    .filter((family) => family.source === 'publication')
    .map((family) => ({
      key: `book:${family.name}`,
      label: family.name,
      value: `${serializeFontFamilyName(family.name)}, serif`,
      previewFamily: null,
    }));
  const allChoices = [...GENERIC_CHOICES, ...readerChoices, ...bookChoices];
  const selected = allChoices.find((choice) => choice.value === value);
  const selectedLabel =
    selected?.label ?? (value !== null ? getFontFamilyDisplayName(value) : 'Book default');

  const normalizedSearch = normalizeSearchValue(search);
  const visible = (choices: readonly FontChoice[]) =>
    choices.filter((choice) => matchesSearch(normalizedSearch, choice.label));
  const visibleSystem = system.fonts.filter((font) =>
    matchesSearch(normalizedSearch, buildSystemFontSearchValue(font)),
  );

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
    setSearch('');
  };
  const addAndPick = async (label: string, load: () => Promise<ArrayBuffer>) => {
    setAdding(label);
    try {
      const next = await fonts.addFont(await load(), label);
      if (next !== null) pick(next);
    } finally {
      setAdding(null);
    }
  };

  const groups: readonly (readonly [string, readonly FontChoice[]])[] = [
    ['Generic', visible(GENERIC_CHOICES)],
    ['Reader fonts', visible(readerChoices)],
    ['This book', visible(bookChoices)],
  ];

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) system.request();
        if (!nextOpen) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid="font-family-combobox"
          className="h-auto min-h-8 w-full justify-between gap-3 py-2 font-normal"
        >
          <FontPreviewText
            preview={{ primaryText: selectedLabel }}
            fontFamily={selected?.previewFamily ?? null}
            className="min-w-0 flex-1 text-left"
          />
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search fonts…" value={search} onValueChange={setSearch} />
          <CommandList>
            {groups.map(([heading, choices]) =>
              choices.length === 0 ? null : (
                <CommandGroup key={heading} heading={heading}>
                  {choices.map((choice) => (
                    <CommandItem
                      key={choice.key}
                      value={choice.key}
                      className="py-2.5"
                      onSelect={() => {
                        pick(choice.value);
                      }}
                      data-checked={value === choice.value}
                    >
                      <FontPreviewText
                        preview={{ primaryText: choice.label }}
                        fontFamily={choice.previewFamily}
                        className="min-w-0 grow"
                      />
                      {choice.removable !== undefined && (
                        <RemoveFontButton
                          label={choice.label}
                          onRemove={() => {
                            if (value === choice.value) onChange(null);
                            void fonts.removeFont(choice.removable ?? '');
                          }}
                        />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
            )}
            <CommandGroup heading="Add a font">
              <CommandItem
                value="import-font-file"
                className="py-2.5"
                onSelect={() => fileInputRef.current?.click()}
              >
                <FileUp className="h-4 w-4" />
                Import a font file (.ttf, .otf)…
              </CommandItem>
              {visibleSystem.map((font) => (
                <CommandItem
                  key={font.family}
                  value={`system:${font.family}`}
                  className="py-2.5"
                  disabled={adding !== null}
                  onSelect={() => {
                    void addAndPick(font.family, font.load);
                  }}
                >
                  <FontPreviewText
                    preview={getSystemFontPreview(font)}
                    fontFamily={font.cssValue}
                    className="min-w-0 grow"
                  />
                  {adding === font.family && <Loader2 className="h-4 w-4 animate-spin" />}
                </CommandItem>
              ))}
            </CommandGroup>
            {allChoices.length === 0 && visibleSystem.length === 0 && (
              <CommandEmpty>No fonts found.</CommandEmpty>
            )}
            <SystemFontsStatus status={system.status} empty={system.fonts.length === 0} />
          </CommandList>
        </Command>
      </PopoverContent>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void addAndPick(file.name.replace(/\.(ttf|otf)$/i, ''), () => file.arrayBuffer());
        }}
      />
    </Popover>
  );
}

function hostChoice(family: ReaderFontFamily, added: ReadonlySet<string>): FontChoice {
  const sha256 = family.faces[0]?.sha256 ?? null;
  const removable = family.faces.find((face) => face.sha256 !== null && added.has(face.sha256));
  return {
    key: `host:${family.name}:${family.genericRole ?? ''}:${family.language ?? ''}`,
    label: family.name,
    value: fontFamilyValue(family.name, family.genericRole),
    // The reader registered the face under its paint alias.
    previewFamily: sha256 !== null ? `"__RitoPinned_${sha256}"` : null,
    ...(removable?.sha256 ? { removable: removable.sha256 } : {}),
  };
}

function RemoveFontButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function SystemFontsStatus({
  status,
  empty,
}: {
  status: ReturnType<typeof useSystemFonts>['status'];
  empty: boolean;
}) {
  const message =
    status === 'loading' && empty
      ? 'Loading system fonts…'
      : status === 'denied'
        ? 'System fonts permission denied'
        : status === 'unsupported'
          ? 'Listing system fonts is not supported in this browser'
          : null;
  return message === null ? null : (
    <div className="py-4 text-center text-sm text-muted-foreground">{message}</div>
  );
}

function getSystemFontPreview(font: SystemFontEntry): FontPreviewSpec {
  if (font.displayLang || font.secondaryName || !sameText(font.displayName, font.family)) {
    return {
      primaryText: font.displayName,
      ...(font.secondaryName ? { secondaryText: font.secondaryName } : {}),
      ...(font.displayLang ? { lang: font.displayLang } : {}),
    };
  }

  return getFontPreviewSpec(font.family, font.displayName);
}

function FontPreviewText({
  preview,
  fontFamily,
  className,
}: {
  preview: FontPreviewSpec;
  fontFamily: string | null;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span
        lang={preview.lang}
        className="truncate leading-tight"
        style={fontFamily !== null ? { fontFamily } : undefined}
      >
        {preview.primaryText}
      </span>
      {preview.secondaryText && (
        <span className="truncate text-xs text-muted-foreground">{preview.secondaryText}</span>
      )}
    </div>
  );
}

function buildSystemFontSearchValue(font: SystemFontEntry): string {
  const preview = getSystemFontPreview(font);
  return buildSearchValue([
    font.displayName,
    font.secondaryName,
    font.family,
    font.fullName,
    font.postscriptName,
    preview.primaryText,
    preview.secondaryText,
  ]);
}

function buildSearchValue(parts: readonly (string | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function matchesSearch(search: string, candidate: string): boolean {
  return search.length === 0 || normalizeSearchValue(candidate).includes(search);
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}
