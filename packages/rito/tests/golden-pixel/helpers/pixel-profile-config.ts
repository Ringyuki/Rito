import type { PixelGoldenProfile, PixelLineBreaking } from './pixel-cases';
import type { PixelGoldenScope, PixelSpreadSelectionMode } from './pixel-spread-selection';

export const PIXEL_LINE_BREAKING = [
  'greedy',
  'optimal',
] as const satisfies readonly PixelLineBreaking[];

const DEFAULT_PROFILE_VALUES = {
  spreadGap: 0,
  devicePixelRatio: 1,
  threshold: 0.08,
  maxDiffPixelRatio: 0.015,
} as const;

type PixelProfileInput = Pick<
  PixelGoldenProfile,
  'id' | 'width' | 'height' | 'margin' | 'spread' | 'tags'
> &
  Partial<
    Pick<PixelGoldenProfile, 'spreadGap' | 'devicePixelRatio' | 'threshold' | 'maxDiffPixelRatio'>
  >;

export const PIXEL_PROFILES = [
  createPixelProfile({
    id: 'single-default',
    width: 600,
    height: 800,
    margin: 40,
    spread: 'single',
    tags: ['single-page', 'default-layout'],
  }),
  createPixelProfile({
    id: 'single-narrow',
    width: 360,
    height: 640,
    margin: 28,
    spread: 'single',
    tags: ['single-page', 'narrow-layout', 'line-breaking-stress'],
  }),
  createPixelProfile({
    id: 'single-wide',
    width: 900,
    height: 1200,
    margin: 64,
    spread: 'single',
    tags: ['single-page', 'wide-layout'],
  }),
  createPixelProfile({
    id: 'single-default-dpr2',
    width: 600,
    height: 800,
    margin: 40,
    spread: 'single',
    devicePixelRatio: 2,
    tags: ['single-page', 'default-layout', 'high-dpi'],
  }),
  createPixelProfile({
    id: 'single-narrow-dpr2',
    width: 360,
    height: 640,
    margin: 28,
    spread: 'single',
    devicePixelRatio: 2,
    tags: ['single-page', 'narrow-layout', 'line-breaking-stress', 'high-dpi'],
  }),
  createPixelProfile({
    id: 'double-default',
    width: 1200,
    height: 800,
    margin: 40,
    spread: 'double',
    spreadGap: 32,
    tags: ['double-page', 'default-layout'],
  }),
  createPixelProfile({
    id: 'double-default-dpr2',
    width: 1200,
    height: 800,
    margin: 40,
    spread: 'double',
    spreadGap: 32,
    devicePixelRatio: 2,
    tags: ['double-page', 'default-layout', 'high-dpi'],
  }),
] as const satisfies readonly PixelGoldenProfile[];

const COMMITTED_PIXEL_PROFILE_IDS = new Set([
  'single-default',
  'single-narrow',
  'single-wide',
  'single-default-dpr2',
  'double-default',
]);

const COMMITTED_PROFILE_LINE_BREAKING: Readonly<Record<string, readonly PixelLineBreaking[]>> = {
  'single-default': ['greedy', 'optimal'],
  'single-narrow': ['greedy', 'optimal'],
  'single-wide': ['greedy'],
  'single-default-dpr2': ['greedy'],
  'double-default': ['greedy'],
};

const COMMITTED_PROFILE_SPREAD_SELECTION: Readonly<Record<string, PixelSpreadSelectionMode>> = {
  'single-default': 'curated',
  'single-narrow': 'curated',
  'single-wide': 'curated',
  'single-default-dpr2': 'curated',
  'double-default': 'curated',
};

export const COMMITTED_PIXEL_PROFILES = PIXEL_PROFILES.filter((profile) =>
  COMMITTED_PIXEL_PROFILE_IDS.has(profile.id),
);

export function lineBreakingForProfile(
  profile: PixelGoldenProfile,
  scope: PixelGoldenScope,
): readonly PixelLineBreaking[] {
  if (scope === 'full') return PIXEL_LINE_BREAKING;
  return COMMITTED_PROFILE_LINE_BREAKING[profile.id] ?? [];
}

export function spreadSelectionModeForProfile(profileId: string): PixelSpreadSelectionMode {
  return COMMITTED_PROFILE_SPREAD_SELECTION[profileId] ?? 'key';
}

export function runTags(
  profile: PixelGoldenProfile,
  lineBreaking: PixelLineBreaking,
  scope: PixelGoldenScope,
): readonly string[] {
  return [
    scope === 'full' ? 'full-book' : 'curated-sample',
    'frontmatter',
    'body',
    'pre-body',
    'post-body',
    'line-breaking',
    lineBreaking === 'optimal' ? 'knuth-plass' : 'greedy',
    ...profile.tags,
  ];
}

function createPixelProfile(input: PixelProfileInput): PixelGoldenProfile {
  const merged = { ...DEFAULT_PROFILE_VALUES, ...input };
  return {
    id: input.id,
    width: input.width,
    height: input.height,
    margin: input.margin,
    spread: input.spread,
    spreadGap: merged.spreadGap,
    devicePixelRatio: merged.devicePixelRatio,
    threshold: merged.threshold,
    maxDiffPixelRatio: merged.maxDiffPixelRatio,
    tags: input.tags,
  };
}
