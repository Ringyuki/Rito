import type { BookFixture } from '../../golden-books/helpers/book-manifest';
import type { PixelGoldenProfile } from './pixel-cases';
import { spreadSelectionModeForProfile } from './pixel-profile-config';

export type PixelGoldenScope = 'curated' | 'full';
export type PixelSpreadSelectionMode = 'all' | 'curated' | 'key' | 'explicit';

export interface PixelSpreadSelection {
  readonly mode: PixelSpreadSelectionMode;
  readonly indexes: readonly number[];
  readonly frontmatterSpreadCount: number;
}

export function spreadSelectionForBook(
  book: BookFixture,
  profile: PixelGoldenProfile,
  scope: PixelGoldenScope,
  selectedSpreadIndexes: readonly number[],
): PixelSpreadSelection {
  if (selectedSpreadIndexes.length > 0) {
    return {
      mode: 'explicit',
      indexes: selectedSpreadIndexes,
      frontmatterSpreadCount: frontmatterSpreadCount(book),
    };
  }

  return {
    mode: scope === 'full' ? 'all' : spreadSelectionModeForProfile(profile.id),
    indexes: [],
    frontmatterSpreadCount: frontmatterSpreadCount(book),
  };
}

export function pixelSpreadIndexesForSelection(
  selection: PixelSpreadSelection,
  totalSpreads: number,
): readonly number[] {
  if (selection.mode === 'explicit') return selection.indexes;
  if (selection.mode === 'curated') {
    return curatedSpreadIndexes(selection.frontmatterSpreadCount, totalSpreads);
  }
  if (selection.mode === 'key') {
    return keySpreadIndexes(selection.frontmatterSpreadCount, totalSpreads);
  }
  return Array.from({ length: totalSpreads }, (_, spreadIndex) => spreadIndex);
}

function frontmatterSpreadCount(book: BookFixture): number {
  return book.pixelFrontmatterSpreadCount ?? 0;
}

function curatedSpreadIndexes(
  frontmatterSpreadCount: number,
  totalSpreads: number,
): readonly number[] {
  const frontmatter = Array.from(
    { length: Math.min(frontmatterSpreadCount, totalSpreads) },
    (_, spreadIndex) => spreadIndex,
  );
  const bodyStart = Math.min(frontmatterSpreadCount, totalSpreads - 1);
  const bodyMiddle = Math.floor((bodyStart + totalSpreads - 1) / 2);
  const tailStart = Math.max(bodyStart, totalSpreads - 2);
  return uniqueValidSpreadIndexes(
    [...frontmatter, bodyStart, bodyStart + 1, bodyMiddle, tailStart, totalSpreads - 1],
    totalSpreads,
  );
}

function keySpreadIndexes(frontmatterSpreadCount: number, totalSpreads: number): readonly number[] {
  const lastFrontmatter = Math.min(frontmatterSpreadCount - 1, totalSpreads - 1);
  const bodyStart = Math.min(frontmatterSpreadCount, totalSpreads - 1);
  const bodyMiddle = Math.floor((bodyStart + totalSpreads - 1) / 2);
  return uniqueValidSpreadIndexes(
    [0, 1, 2, lastFrontmatter, bodyStart, bodyMiddle, totalSpreads - 1],
    totalSpreads,
  );
}

function uniqueValidSpreadIndexes(
  spreadIndexes: readonly number[],
  totalSpreads: number,
): readonly number[] {
  return [...new Set(spreadIndexes)].filter(
    (spreadIndex) => spreadIndex >= 0 && spreadIndex < totalSpreads,
  );
}
