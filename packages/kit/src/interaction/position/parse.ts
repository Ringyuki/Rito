import type { ReaderLocator, ReaderSourcePoint } from '@ritojs/core';
import type { ReadingLocator, ReadingPosition } from './model';

export function parsePosition(serialized: string): ReadingPosition | undefined {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isPosition(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPosition(value: unknown): value is ReadingPosition {
  if (!isRecord(value) || !isProjection(value['projection'])) return false;
  if (!isProgression(value['progress']) || !isTimestamp(value['timestamp'])) return false;
  if (value['sourceLocator'] !== undefined && !isSourceLocator(value['sourceLocator']))
    return false;
  if (value['locator'] !== undefined && !isLegacyLocator(value['locator'])) return false;
  return true;
}

function isProjection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isIndex(value['spreadIndex']) && isIndex(value['pageIndex']);
}

function isSourceLocator(value: unknown): value is ReaderLocator {
  if (!isRecord(value) || typeof value['href'] !== 'string' || value['href'].length === 0) {
    return false;
  }
  if (value['anchorId'] !== undefined && typeof value['anchorId'] !== 'string') return false;
  if (value['sourcePoint'] !== undefined && !isSourcePoint(value['sourcePoint'])) return false;
  if (value['sourceRange'] !== undefined && !isSourceRange(value['sourceRange'])) return false;
  return value['progression'] === undefined || isProgression(value['progression']);
}

function isLegacyLocator(value: unknown): value is ReadingLocator {
  if (!isRecord(value) || typeof value['spineIdref'] !== 'string') return false;
  if (!isProgression(value['chapterProgress'])) return false;
  if (value['manifestHref'] !== undefined && typeof value['manifestHref'] !== 'string')
    return false;
  return value['sourcePoint'] === undefined || isSourcePoint(value['sourcePoint']);
}

function isSourceRange(value: unknown): boolean {
  return isRecord(value) && isSourcePoint(value['start']) && isSourcePoint(value['end']);
}

function isSourcePoint(value: unknown): value is ReaderSourcePoint {
  if (!isRecord(value) || !Array.isArray(value['nodePath'])) return false;
  return value['nodePath'].every(isIndex) && isIndex(value['textOffset']);
}

function isProgression(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
