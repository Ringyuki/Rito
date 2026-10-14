import { Info, RotateCcw } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FontFamilyCombobox } from '@/components/font-family-combobox';
import type { ReaderFonts } from '@/hooks/use-reader-fonts';
import type { TransitionEffectName } from '@ritojs/kit';

/** How pages turn: a built-in effect, or the simulated sheet of paper. */
export type PageTurn = TransitionEffectName | 'paper';

export interface ReaderSettings {
  /** Root font size in px, passed to `setTypography`; changing it re-lays the text. */
  fontSize: number;
  lineHeight: number;
  /** Whether the lineHeight slider value is applied at all. False = use book's own line-height. */
  lineHeightActive: boolean;
  /** When true, the override is forced on every element (overrides element-level CSS). */
  lineHeightForce: boolean;
  /** CSS font-family value passed to setTypography. null = use book's own font. */
  fontFamily: string | null;
  /** When true, the font family replaces every element's own. */
  fontFamilyForce: boolean;
  spreadMode: 'single' | 'double';
  theme: 'light' | 'dark';
  /** Canvas zoom (`setRenderScale`): sharper glyphs, same pagination. */
  renderScale: number;
  /** How pages turn (`configureTransition({ effect })`). */
  pageTurn: PageTurn;
}

const PAGE_TURNS: SegmentedOption<PageTurn>[] = [
  { value: 'slide', label: 'Slide' },
  { value: 'cover', label: 'Cover' },
  { value: 'paper', label: 'Paper' },
  { value: 'fade', label: 'Fade' },
  { value: 'none', label: 'None' },
];

const ZOOM_LEVELS = [
  { value: '1', label: '100%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' },
];

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ReaderSettings;
  onFontSizeChange: (value: number) => void;
  onLineHeightChange: (value: number) => void;
  onLineHeightForceChange: (value: boolean) => void;
  onUseBookLineHeight: () => void;
  onFontFamilyChange: (value: string | null) => void;
  onFontFamilyForceChange: (value: boolean) => void;
  fonts: ReaderFonts;
  onRenderScaleChange: (value: number) => void;
  onPageTurnChange: (value: PageTurn) => void;
  onSpreadModeChange: (value: 'single' | 'double') => void;
  onThemeChange: (value: 'light' | 'dark') => void;
  onRestoreDefaults: () => void;
}

export function SettingsPanel({
  open,
  onOpenChange,
  settings,
  onFontSizeChange,
  onLineHeightChange,
  onLineHeightForceChange,
  onUseBookLineHeight,
  onFontFamilyChange,
  onFontFamilyForceChange,
  fonts,
  onRenderScaleChange,
  onPageTurnChange,
  onSpreadModeChange,
  onThemeChange,
  onRestoreDefaults,
}: SettingsPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Reader Settings</SheetTitle>
          <SheetDescription>Tune typography and layout to taste.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
          <Section label="Font Size" value={`${String(settings.fontSize)}px`}>
            <Slider
              min={12}
              max={28}
              step={1}
              value={[settings.fontSize]}
              onValueChange={([v]) => {
                if (v !== undefined) onFontSizeChange(v);
              }}
            />
          </Section>

          <Section
            label="Line Height"
            value={settings.lineHeight.toFixed(2)}
            action={
              <Button
                variant="ghost"
                size="xs"
                onClick={onUseBookLineHeight}
                disabled={!settings.lineHeightActive}
                className="font-normal text-muted-foreground"
              >
                Book default
              </Button>
            }
          >
            <Slider
              min={1.0}
              max={2.0}
              step={0.05}
              value={[settings.lineHeight]}
              onValueChange={([v]) => {
                if (v !== undefined) onLineHeightChange(v);
              }}
              className={cn(!settings.lineHeightActive && 'opacity-60')}
            />
            <div className="flex items-center gap-2">
              <Switch
                id="line-height-force"
                size="sm"
                checked={settings.lineHeightActive && settings.lineHeightForce}
                onCheckedChange={onLineHeightForceChange}
              />
              <Label
                htmlFor="line-height-force"
                className="text-xs font-normal text-muted-foreground"
              >
                Apply to every element
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Why apply to every element"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-xs">
                  Some books set line-height on individual paragraphs. Without this, the slider only
                  affects elements that don&apos;t style themselves.
                </TooltipContent>
              </Tooltip>
            </div>
          </Section>

          <Section label="Font Family">
            <FontFamilyCombobox
              value={settings.fontFamily}
              onChange={onFontFamilyChange}
              fonts={fonts}
            />
            <div className="flex items-center gap-2">
              <Switch
                id="font-family-force"
                size="sm"
                checked={settings.fontFamilyForce}
                onCheckedChange={onFontFamilyForceChange}
                disabled={settings.fontFamily === null}
              />
              <Label
                htmlFor="font-family-force"
                className="text-xs font-normal text-muted-foreground"
              >
                Apply to every element
              </Label>
            </div>
          </Section>

          <Section label="Zoom">
            <SegmentedControl
              value={String(settings.renderScale)}
              onChange={(value) => {
                onRenderScaleChange(Number(value));
              }}
              options={ZOOM_LEVELS}
            />
          </Section>

          <Separator />

          <Section label="Layout">
            <SegmentedControl
              value={settings.spreadMode}
              onChange={onSpreadModeChange}
              options={[
                { value: 'single', label: 'Single Page' },
                { value: 'double', label: 'Double Page' },
              ]}
            />
          </Section>

          <Section label="Page Turn">
            <SegmentedControl
              value={settings.pageTurn}
              onChange={onPageTurnChange}
              options={PAGE_TURNS}
            />
          </Section>

          <Section label="Theme">
            <SegmentedControl
              value={settings.theme}
              onChange={onThemeChange}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Section>

          <Separator />

          <Button variant="outline" onClick={onRestoreDefaults} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Restore Defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  label,
  value,
  action,
  children,
}: {
  label: string;
  value?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex items-center gap-2">
          {action}
          {value !== undefined && (
            <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
}) {
  return (
    <div className="grid w-full auto-cols-fr grid-flow-col gap-1 rounded-md bg-muted p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'rounded-sm px-2 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
