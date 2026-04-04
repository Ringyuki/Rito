import { useCallback, useState } from 'react';
import type { ReaderController } from '@rito/kit';

export interface SettingsPanelProps {
  readonly controller: ReaderController | null;
  readonly className?: string | undefined;
}

interface SettingsState {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
}

const FONT_FAMILIES = [
  { label: 'System Default', value: '' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Sans-serif', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Monospace', value: '"Courier New", monospace' },
] as const;

const INITIAL: SettingsState = { fontSize: 16, lineHeight: 1.5, fontFamily: '' };

export function SettingsPanel({ controller, className }: SettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState(INITIAL);

  const apply = useCallback(
    (patch: Partial<SettingsState>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      const opts: { fontSize: number; lineHeight: number; fontFamily?: string } = {
        fontSize: next.fontSize,
        lineHeight: next.lineHeight,
      };
      if (next.fontFamily) opts.fontFamily = next.fontFamily;
      controller?.setTypography(opts);
    },
    [controller, settings],
  );

  return (
    <div className={className} style={className ? undefined : defaultStyle}>
      <label style={labelStyle}>
        Font
        <select
          value={settings.fontFamily}
          onChange={(e) => {
            apply({ fontFamily: e.target.value });
          }}
          style={inputStyle}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        <span>Size: {String(settings.fontSize)}px</span>
        <input
          type="range"
          min={12}
          max={28}
          step={1}
          value={settings.fontSize}
          onChange={(e) => {
            apply({ fontSize: Number(e.target.value) });
          }}
          style={{ width: '100%' }}
        />
      </label>

      <label style={labelStyle}>
        <span>Line Height: {settings.lineHeight.toFixed(1)}</span>
        <input
          type="range"
          min={1.2}
          max={2.0}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => {
            apply({ lineHeight: Number(e.target.value) });
          }}
          style={{ width: '100%' }}
        />
      </label>
    </div>
  );
}

const defaultStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '1rem',
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.875rem',
};
const inputStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  fontSize: '0.875rem',
  borderRadius: '0.25rem',
  border: '1px solid #ccc',
};
