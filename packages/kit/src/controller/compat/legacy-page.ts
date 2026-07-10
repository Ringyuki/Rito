import type { Page, Spread } from '@ritojs/core';
import type { Page as LegacyPage, Spread as LegacySpread } from '../../interaction/index';

export function asLegacyPage(page: Page): LegacyPage {
  return page as unknown as LegacyPage;
}

export function asLegacyPages(pages: readonly Page[]): readonly LegacyPage[] {
  return pages.map(asLegacyPage);
}

export function asLegacySpread(spread: Spread): LegacySpread {
  return spread as unknown as LegacySpread;
}

export function asLegacySpreads(spreads: readonly Spread[]): readonly LegacySpread[] {
  return spreads.map(asLegacySpread);
}
