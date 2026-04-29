type UnknownRecord = { readonly [key: string]: unknown };

export function commandShapeError(command: UnknownRecord, kind: string): string | undefined {
  switch (kind) {
    case 'openSession':
      return openSessionShapeError(command);
    case 'createRevision':
      return requireSessionAndPayload(command);
    case 'cancelRevision':
      return requireSessionAndRevision(command);
    case 'resolveLocator':
      return resolveLocatorShapeError(command);
    case 'resolveLocatorGeometry':
      return resolveLocatorGeometryShapeError(command);
    case 'getSpreadFrame':
      return spreadFrameShapeError(command);
    case 'prefetch':
      return prefetchShapeError(command);
    case 'search':
      return searchShapeError(command);
    case 'getFootnote':
      return getFootnoteShapeError(command);
    case 'getResource':
      return getResourceShapeError(command);
    case 'closeSession':
      return requireSession(command);
    default:
      return 'Reader runtime command kind is invalid';
  }
}

function openSessionShapeError(command: UnknownRecord): string | undefined {
  const payload = command['payload'];
  if (!isRecord(payload) || typeof payload['publicationRef'] !== 'string') {
    return 'openSession command payload is invalid';
  }
  return undefined;
}

function spreadFrameShapeError(command: UnknownRecord): string | undefined {
  const payloadError = requireSessionRevisionAndPayload(command);
  if (payloadError !== undefined) return payloadError;
  const payload = command['payload'];
  if (!isRecord(payload) || typeof payload['spreadIndex'] !== 'number') {
    return 'getSpreadFrame command payload is invalid';
  }
  return undefined;
}

function prefetchShapeError(command: UnknownRecord): string | undefined {
  const payloadError = requireSessionRevisionAndPayload(command);
  if (payloadError !== undefined) return payloadError;
  const payload = command['payload'];
  if (!isRecord(payload) || !isNumberArray(payload['spreadIndexes'])) {
    return 'prefetch command payload is invalid';
  }
  return undefined;
}

function searchShapeError(command: UnknownRecord): string | undefined {
  const payloadError = requireSessionRevisionAndPayload(command);
  if (payloadError !== undefined) return payloadError;
  const payload = command['payload'];
  if (!isRecord(payload) || typeof payload['query'] !== 'string') {
    return 'search command payload is invalid';
  }
  if (payload['revisionId'] !== undefined) {
    return 'search command payload must not include revisionId';
  }
  if (payload['caseSensitive'] !== undefined && typeof payload['caseSensitive'] !== 'boolean') {
    return 'search command payload is invalid';
  }
  if (payload['wholeWord'] !== undefined && typeof payload['wholeWord'] !== 'boolean') {
    return 'search command payload is invalid';
  }
  if (payload['limit'] !== undefined && !isPositiveInteger(payload['limit'])) {
    return 'search command payload is invalid';
  }
  return undefined;
}

function resolveLocatorShapeError(command: UnknownRecord): string | undefined {
  const payloadError = requireSessionRevisionAndPayload(command);
  if (payloadError !== undefined) return payloadError;
  const payload = command['payload'];
  if (!isRecord(payload) || !isReaderLocator(payload['locator'])) {
    return 'resolveLocator command payload is invalid';
  }
  return undefined;
}

function resolveLocatorGeometryShapeError(command: UnknownRecord): string | undefined {
  const payloadError = requireSessionRevisionAndPayload(command);
  if (payloadError !== undefined) return payloadError;
  const payload = command['payload'];
  if (!isRecord(payload) || !isReaderLocator(payload['locator'])) {
    return 'resolveLocatorGeometry command payload is invalid';
  }
  return undefined;
}

function getResourceShapeError(command: UnknownRecord): string | undefined {
  const payloadError = requireSessionRevisionAndPayload(command);
  if (payloadError !== undefined) return payloadError;
  const payload = command['payload'];
  if (!isRecord(payload) || !isReaderResourceRef(payload['resource'])) {
    return 'getResource command payload is invalid';
  }
  return undefined;
}

function getFootnoteShapeError(command: UnknownRecord): string | undefined {
  const payloadError = requireSessionRevisionAndPayload(command);
  if (payloadError !== undefined) return payloadError;
  const payload = command['payload'];
  if (!isRecord(payload) || !isReaderFootnoteRef(payload['ref'])) {
    return 'getFootnote command payload is invalid';
  }
  return undefined;
}

function requireSessionAndPayload(command: UnknownRecord): string | undefined {
  const sessionError = requireSession(command);
  if (sessionError !== undefined) return sessionError;
  if (!isRecord(command['payload'])) return 'Reader runtime command payload is invalid';
  return undefined;
}

function requireSessionRevisionAndPayload(command: UnknownRecord): string | undefined {
  const revisionError = requireSessionAndRevision(command);
  if (revisionError !== undefined) return revisionError;
  if (!isRecord(command['payload'])) return 'Reader runtime command payload is invalid';
  return undefined;
}

function requireSessionAndRevision(command: UnknownRecord): string | undefined {
  const sessionError = requireSession(command);
  if (sessionError !== undefined) return sessionError;
  if (!isNonEmptyString(command['revisionId'])) {
    return 'Reader runtime command revisionId is missing or invalid';
  }
  return undefined;
}

function requireSession(command: UnknownRecord): string | undefined {
  if (!isNonEmptyString(command['sessionId'])) {
    return 'Reader runtime command sessionId is missing or invalid';
  }
  return undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isReaderLocator(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value['href'])) return false;
  if (!isNonEmptyString(value['mediaType'])) return false;
  if (typeof value['progression'] !== 'number') return false;
  if (value['totalProgression'] !== undefined && typeof value['totalProgression'] !== 'number')
    return false;
  if (value['position'] !== undefined && typeof value['position'] !== 'number') return false;
  if (value['anchorId'] !== undefined && !isNonEmptyString(value['anchorId'])) return false;
  if (value['text'] !== undefined && !isLocatorText(value['text'])) return false;
  if (value['sourceRange'] !== undefined && !isLocatorSourceRange(value['sourceRange']))
    return false;
  return true;
}

function isLocatorText(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value['before'] !== undefined && typeof value['before'] !== 'string') return false;
  if (value['highlight'] !== undefined && typeof value['highlight'] !== 'string') return false;
  if (value['after'] !== undefined && typeof value['after'] !== 'string') return false;
  return true;
}

function isLocatorSourceRange(value: unknown): boolean {
  return isRecord(value) && typeof value['start'] === 'number' && typeof value['end'] === 'number';
}

function isReaderResourceRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value['id']) || !isNonEmptyString(value['href'])) return false;
  if (!isResourceKind(value['kind'])) return false;
  if (value['mediaType'] !== undefined && typeof value['mediaType'] !== 'string') return false;
  if (value['hash'] !== undefined && typeof value['hash'] !== 'string') return false;
  return true;
}

function isReaderFootnoteRef(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value['href']);
}

function isResourceKind(value: unknown): boolean {
  return value === 'font' || value === 'image' || value === 'stylesheet' || value === 'publication';
}
