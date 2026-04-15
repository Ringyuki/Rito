import { RotateCcw } from 'lucide-react';
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
import { cn } from '@/lib/utils';

export type FontPreset = 'default' | 'serif' | 'sans' | 'mono';

export interface ReaderSettings {
  fontScale: number;
  lineHeight: number;
  fontPreset: FontPreset;
  spreadMode: 'single' | 'double';
  theme: 'light' | 'dark';
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontScale: 1.2,
  lineHeight: 1.2,
  fontPreset: 'default',
  spreadMode: 'double',
  theme: 'light',
};

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ReaderSettings;
  onFontScaleChange: (value: number) => void;
  onLineHeightChange: (value: number) => void;
  onFontPresetChange: (value: FontPreset) => void;
  onSpreadModeChange: (value: 'single' | 'double') => void;
  onThemeChange: (value: 'light' | 'dark') => void;
  onRestoreDefaults: () => void;
}

export function SettingsPanel({
  open,
  onOpenChange,
  settings,
  onFontScaleChange,
  onLineHeightChange,
  onFontPresetChange,
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
          <Section label="Font Size" value={`${String(Math.round(settings.fontScale * 100))}%`}>
            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={[settings.fontScale]}
              onValueChange={([v]) => {
                if (v !== undefined) onFontScaleChange(v);
              }}
            />
          </Section>

          <Section label="Line Height" value={settings.lineHeight.toFixed(2)}>
            <Slider
              min={1.0}
              max={2.0}
              step={0.05}
              value={[settings.lineHeight]}
              onValueChange={([v]) => {
                if (v !== undefined) onLineHeightChange(v);
              }}
            />
          </Section>

          <Section label="Font Family">
            <SegmentedControl
              value={settings.fontPreset}
              onChange={onFontPresetChange}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'serif', label: 'Serif' },
                { value: 'sans', label: 'Sans' },
                { value: 'mono', label: 'Mono' },
              ]}
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
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        {value !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
        )}
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
