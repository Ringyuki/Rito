import type { Reader, ReaderLocator } from '@ritojs/core';
import type { ChapterLocalPresentationLease } from '../machine';

const PRESENTATION = Symbol.for('@ritojs/core/browser/chapter-local-preview-presentation');

interface ChapterLocalPresentationCapability {
  canClaim(locator: ReaderLocator, spreadIndex: number): boolean;
  claim(locator: ReaderLocator, spreadIndex: number): ChapterLocalPresentationLease | undefined;
}

export function canClaimChapterLocalPresentation(
  reader: Reader,
  locator: ReaderLocator,
  spreadIndex: number,
): boolean {
  const capability = presentationCapability(reader);
  return capability?.canClaim(locator, spreadIndex) ?? false;
}

export function claimChapterLocalPresentation(
  reader: Reader,
  locator: ReaderLocator,
  spreadIndex: number,
): ChapterLocalPresentationLease | undefined {
  return presentationCapability(reader)?.claim(locator, spreadIndex);
}

function presentationCapability(reader: Reader): ChapterLocalPresentationCapability | undefined {
  const host = reader as Reader & { readonly [PRESENTATION]?: unknown };
  const capability = host[PRESENTATION];
  return isCapability(capability) ? capability : undefined;
}

function isCapability(value: unknown): value is ChapterLocalPresentationCapability {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Partial<ChapterLocalPresentationCapability>).canClaim === 'function' &&
    typeof (value as Partial<ChapterLocalPresentationCapability>).claim === 'function'
  );
}
