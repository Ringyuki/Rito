import type { Page } from '@ritojs/core';
import { asLegacyPage } from './controller/compat/legacy-page';
import { buildHitMap as buildInteractionHitMap, type HitMap } from './interaction/index';

/**
 * Builds a hit map for a production reader page. The interaction layer
 * types pages with its own display-list shape while `@ritojs/core`
 * publishes `Page.content` opaquely; the two are the same objects at
 * runtime (the controller wiring crosses the same bridge).
 */
export function buildHitMap(page: Page): HitMap {
  return buildInteractionHitMap(asLegacyPage(page));
}
