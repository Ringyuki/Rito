import { useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { getFontPreviewSpec, type FontPreviewSpec } from '@/lib/font-preview';
import { getFontFamilyDisplayName } from '@/lib/font-family-value';

interface FontFamilyComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

interface FontPreset {
  readonly label: string;
  readonly value: string | null;
}

const FONT_PRESETS: readonly FontPreset[] = [
  { value: null, label: 'Book default' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', label: 'Sans' },
  { value: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', label: 'Mono' },
];

export function FontFamilyCombobox({ value, onChange }: FontFamilyComboboxProps) {
  const { fonts, status, request } = useSystemFonts();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedPreset = FONT_PRESETS.find((preset) => preset.value === value);
  const selectedFont =
    value !== null ? fonts.find((font) => matchesFontValue(font, value)) : undefined;
  const selectedDisplayValue = value !== null ? getFontFamilyDisplayName(value) : null;
  const selectedLabel =
    selectedPreset?.label ?? selectedFont?.displayName ?? selectedDisplayValue ?? 'Book default';
  const selectedPreview =
    selectedFont !== undefined
      ? getSystemFontPreview(selectedFont)
      : getFontPreviewSpec(selectedDisplayValue, selectedLabel, {
          isPreset: selectedPreset !== undefined && value !== null,
        });
  const showExternalChoice =
    value !== null && selectedPreset === undefined && selectedFont === undefined;
  const externalValue = showExternalChoice ? value : null;
  const externalDisplayValue =
    externalValue !== null ? getFontFamilyDisplayName(externalValue) : null;
  const externalPreview =
    externalDisplayValue !== null
      ? getFontPreviewSpec(externalDisplayValue, externalDisplayValue)
      : undefined;

  const normalizedSearch = normalizeSearchValue(search);
  const visiblePresets = FONT_PRESETS.filter((preset) =>
    matchesSearch(normalizedSearch, buildPresetSearchValue(preset)),
  );
  const showExternalChoiceGroup =
    externalValue !== null &&
    matchesSearch(
      normalizedSearch,
      buildSearchValue([
        externalValue,
        externalDisplayValue,
        externalPreview?.primaryText,
        externalPreview?.secondaryText,
      ]),
    );
  const externalChoice = showExternalChoiceGroup
    ? {
        value: externalValue,
        displayValue: externalDisplayValue,
        preview: externalPreview,
      }
    : null;
  const visibleFonts = fonts.filter((font) =>
    matchesSearch(normalizedSearch, buildSystemFontSearchValue(font)),
  );
  const hasVisibleItems =
    visiblePresets.length > 0 || showExternalChoiceGroup || visibleFonts.length > 0;

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) request();
        if (!nextOpen) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto min-h-8 w-full justify-between gap-3 py-2 font-normal"
        >
          <FontPreviewText
            preview={selectedPreview}
            fontFamily={selectedFont?.cssValue ?? value}
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
          <CommandInput
            placeholder="Search font or script…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {visiblePresets.length > 0 && (
              <CommandGroup heading="Presets">
                {visiblePresets.map((preset) => {
                  const preview = getFontPreviewSpec(preset.value, preset.label, {
                    isPreset: preset.value !== null,
                  });
                  return (
                    <CommandItem
                      key={preset.label}
                      value={buildPresetSearchValue(preset)}
                      className="py-2.5"
                      onSelect={() => {
                        pick(preset.value);
                      }}
                      data-checked={value === preset.value}
                    >
                      <FontPreviewText
                        preview={preview}
                        fontFamily={preset.value}
                        className="min-w-0 grow"
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {externalChoice !== null && (
              <CommandGroup heading="Current Choice">
                <CommandItem
                  value={buildSearchValue([
                    externalChoice.value,
                    externalChoice.displayValue,
                    externalChoice.preview?.primaryText,
                    externalChoice.preview?.secondaryText,
                  ])}
                  className="py-2.5"
                  onSelect={() => {
                    pick(externalChoice.value);
                  }}
                  data-checked="true"
                >
                  <FontPreviewText
                    preview={
                      externalChoice.preview ??
                      getFontPreviewSpec(
                        externalChoice.displayValue,
                        externalChoice.displayValue ?? externalChoice.value,
                      )
                    }
                    fontFamily={externalChoice.value}
                    className="min-w-0 grow"
                  />
                </CommandItem>
              </CommandGroup>
            )}
            {visibleFonts.length > 0 && (
              <CommandGroup heading="System Fonts">
                {visibleFonts.map((font) => {
                  const preview = getSystemFontPreview(font);
                  return (
                    <CommandItem
                      key={font.family}
                      value={buildSystemFontSearchValue(font)}
                      className="py-2.5"
                      onSelect={() => {
                        pick(font.cssValue);
                      }}
                      data-checked={value !== null && matchesFontValue(font, value)}
                    >
                      <FontPreviewText
                        preview={preview}
                        fontFamily={font.cssValue}
                        className="min-w-0 grow"
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {!hasVisibleItems && <CommandEmpty>No fonts found.</CommandEmpty>}
            {status === 'loading' && fonts.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading system fonts…
              </div>
            )}
            {status === 'denied' && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                System fonts permission denied
              </div>
            )}
            {status === 'unsupported' && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                System font browsing is not supported in this browser
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
        className="truncate text-[1.02rem] leading-tight"
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

function buildPresetSearchValue(preset: FontPreset): string {
  const preview = getFontPreviewSpec(preset.value, preset.label, {
    isPreset: preset.value !== null,
  });
  return buildSearchValue([preset.label, preview.primaryText, preview.secondaryText]);
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

function matchesFontValue(font: SystemFontEntry, value: string): boolean {
  return value === font.cssValue || value === font.family;
}

function matchesSearch(search: string, candidate: string): boolean {
  return search.length === 0 || normalizeSearchValue(candidate).includes(search);
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}
