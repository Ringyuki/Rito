/**
 * Build an AnnotationTarget from the selection's durable source range. The
 * engine builds it, so the target is byte-for-byte what every other host
 * would store for the same range.
 */

import type { ReaderLocator } from '@ritojs/core';
import type { AnnotationTarget } from '../../interaction/index';
import type { Internals } from '../core/internals';

export async function buildAnnotationTargetFromLocator(
  locator: ReaderLocator,
  internals: Internals,
): Promise<AnnotationTarget | undefined> {
  const sourceRange = locator.sourceRange;
  const interactions = internals.reader.interactions;
  if (!sourceRange || !interactions?.createAnnotationTarget) return undefined;
  return interactions.createAnnotationTarget({ href: locator.href, sourceRange });
}
