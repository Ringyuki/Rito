/**
 * Build a ChapterTextIndex from rendered page HitMaps.
 * This allows annotation target creation and resolution without
 * access to the parsed DocumentNode tree — we reconstruct the
 * chapter text from HitEntry sourceRefs instead.
 */

import type { ChapterTextIndex, ChapterTextSpan } from 'rito/annotations';
import type { HitMap } from 'rito/advanced';

/**
 * Build a chapter text index from the HitMaps of pages belonging to one chapter.
 * Walks entries in page order, collecting sourceRef-bearing entries to build
 * the normalized text and span mapping.
 *
 * When a source text node is split across multiple runs (e.g. "Hello " and "world"),
 * each run carries a `sourceTextOffset` indicating where it starts in the source
 * text node. We accumulate text per nodePath and compute correct source offsets.
 */
export function buildChapterTextIndexFromHitMaps(
  href: string,
  hitMaps: readonly HitMap[],
): ChapterTextIndex {
  const spans: ChapterTextSpan[] = [];
  const parts: string[] = [];
  let offset = 0;

  // Track accumulated text length per nodePath to handle split text nodes
  const nodeAccumulated = new Map<string, { totalLength: number; sourceEnd: number }>();

  for (const hitMap of hitMaps) {
    for (const entry of hitMap.entries) {
      if (!entry.sourceRef || entry.text.length === 0) continue;

      const pathKey = entry.sourceRef.nodePath.join(',');
      const sourceTextOffset = entry.sourceTextOffset ?? 0;
      const existing = nodeAccumulated.get(pathKey);

      if (existing) {
        // This is a continuation of a previously seen text node.
        // Check if this run extends beyond what we've already accumulated.
        const entrySourceEnd = sourceTextOffset + entry.text.length;
        if (entrySourceEnd <= existing.sourceEnd) {
          // Already covered by a previous entry — skip
          continue;
        }
        // We need to add the new portion
        const overlapLength = Math.max(0, existing.sourceEnd - sourceTextOffset);
        const newText = entry.text.slice(overlapLength);
        if (newText.length === 0) continue;

        const newSourceStart = existing.sourceEnd;
        spans.push({
          nodePath: entry.sourceRef.nodePath,
          sourceStart: newSourceStart,
          sourceEnd: entrySourceEnd,
          normalizedStart: offset,
          normalizedEnd: offset + newText.length,
        });
        parts.push(newText);
        offset += newText.length;
        existing.totalLength += newText.length;
        existing.sourceEnd = entrySourceEnd;
      } else {
        // First time seeing this text node
        spans.push({
          nodePath: entry.sourceRef.nodePath,
          sourceStart: sourceTextOffset,
          sourceEnd: sourceTextOffset + entry.text.length,
          normalizedStart: offset,
          normalizedEnd: offset + entry.text.length,
        });
        parts.push(entry.text);
        offset += entry.text.length;
        nodeAccumulated.set(pathKey, {
          totalLength: entry.text.length,
          sourceEnd: sourceTextOffset + entry.text.length,
        });
      }
    }
  }

  return { href, normalizedText: parts.join(''), spans };
}
