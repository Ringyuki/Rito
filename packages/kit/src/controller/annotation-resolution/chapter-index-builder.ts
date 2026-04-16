/**
 * Build a ChapterTextIndex from rendered page HitMaps.
 * This allows annotation target creation and resolution without
 * access to the parsed DocumentNode tree — we reconstruct the
 * chapter text from HitEntry sourceRefs instead.
 */

import type { ChapterTextIndex, ChapterTextSpan } from '@ritojs/core/annotations';
import type { HitMap } from '@ritojs/core/advanced';

/**
 * Build a chapter text index from the HitMaps of pages belonging to one chapter.
 * Walks entries in page order, collecting sourceRef-bearing entries to build
 * the normalized text and span mapping.
 *
 * When a source text node is split across multiple runs (e.g. "Hello " and "world"),
 * each run carries a `sourceTextOffset` indicating where it starts in the source
 * text node. We accumulate text per nodePath and compute correct source offsets.
 */
interface BuildState {
  spans: ChapterTextSpan[];
  parts: string[];
  offset: number;
  nodeAccumulated: Map<string, { totalLength: number; sourceEnd: number }>;
}

export function buildChapterTextIndexFromHitMaps(
  href: string,
  hitMaps: readonly HitMap[],
): ChapterTextIndex {
  const state: BuildState = {
    spans: [],
    parts: [],
    offset: 0,
    nodeAccumulated: new Map(),
  };

  for (const hitMap of hitMaps) {
    for (const entry of hitMap.entries) {
      if (entry.sourceRef && entry.text.length > 0) {
        processEntry(state, entry);
      }
    }
  }

  return { href, normalizedText: state.parts.join(''), spans: state.spans };
}

function processEntry(state: BuildState, entry: HitMap['entries'][number]): void {
  const sourceRef = entry.sourceRef;
  if (!sourceRef) return;
  const pathKey = sourceRef.nodePath.join(',');
  const sourceTextOffset = entry.sourceTextOffset ?? 0;
  const existing = state.nodeAccumulated.get(pathKey);

  if (existing) {
    appendContinuation(state, sourceRef.nodePath, entry.text, existing, sourceTextOffset);
  } else {
    appendFirstOccurrence(state, sourceRef.nodePath, entry.text, pathKey, sourceTextOffset);
  }
}

function appendContinuation(
  state: BuildState,
  nodePath: readonly number[],
  text: string,
  existing: { totalLength: number; sourceEnd: number },
  sourceTextOffset: number,
): void {
  const entrySourceEnd = sourceTextOffset + text.length;
  if (entrySourceEnd <= existing.sourceEnd) return;

  const overlapLength = Math.max(0, existing.sourceEnd - sourceTextOffset);
  const newText = text.slice(overlapLength);
  if (newText.length === 0) return;

  state.spans.push({
    nodePath,
    sourceStart: existing.sourceEnd,
    sourceEnd: entrySourceEnd,
    normalizedStart: state.offset,
    normalizedEnd: state.offset + newText.length,
  });
  state.parts.push(newText);
  state.offset += newText.length;
  existing.totalLength += newText.length;
  existing.sourceEnd = entrySourceEnd;
}

function appendFirstOccurrence(
  state: BuildState,
  nodePath: readonly number[],
  text: string,
  pathKey: string,
  sourceTextOffset: number,
): void {
  state.spans.push({
    nodePath,
    sourceStart: sourceTextOffset,
    sourceEnd: sourceTextOffset + text.length,
    normalizedStart: state.offset,
    normalizedEnd: state.offset + text.length,
  });
  state.parts.push(text);
  state.offset += text.length;
  state.nodeAccumulated.set(pathKey, {
    totalLength: text.length,
    sourceEnd: sourceTextOffset + text.length,
  });
}
