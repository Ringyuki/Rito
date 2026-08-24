import { createLayoutConfig, type LayoutConfig } from '../../../src/reference/ts-core/layout/core';

export type GoldenLineBreaking = 'greedy' | 'optimal';

export interface GoldenBookConfig {
  readonly id: string;
  readonly lineBreaking: GoldenLineBreaking;
  readonly layout: LayoutConfig;
}

const ALL_GOLDEN_CONFIGS: readonly GoldenBookConfig[] = [
  {
    id: 'default.greedy',
    lineBreaking: 'greedy',
    layout: createLayoutConfig({ width: 600, height: 800, margin: 40 }),
  },
  {
    id: 'narrow.greedy',
    lineBreaking: 'greedy',
    layout: createLayoutConfig({ width: 360, height: 640, margin: 28 }),
  },
  {
    id: 'default.optimal',
    lineBreaking: 'optimal',
    layout: createLayoutConfig({ width: 600, height: 800, margin: 40 }),
  },
];

export const SMOKE_CONFIG: GoldenBookConfig = {
  id: 'smoke.greedy',
  lineBreaking: 'greedy',
  layout: createLayoutConfig({ width: 420, height: 640, margin: 24 }),
};

export function getGoldenBookConfigs(): readonly GoldenBookConfig[] {
  const selected = parseSelectedConfigIds(process.env['RITO_GOLDEN_CONFIGS']);
  const configs = getAllGoldenBookConfigs();
  if (selected.size === 0) return configs;
  return configs.filter((config) => selected.has(config.id));
}

export function getAllGoldenBookConfigs(): readonly GoldenBookConfig[] {
  return ALL_GOLDEN_CONFIGS;
}

export function getGoldenBookConfigById(id: string): GoldenBookConfig | undefined {
  return ALL_GOLDEN_CONFIGS.find((config) => config.id === id);
}

function parseSelectedConfigIds(value: string | undefined): ReadonlySet<string> {
  if (value === undefined || value.length === 0) return new Set<string>();
  return new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}
