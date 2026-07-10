const FULL_CHAPTER_TEXT_INDICES_SCOPE_KEY = 'chapter-text-v1:full';
const sessionCacheState = new WeakMap();

export function normalizeReaderSessionCache(cache) {
  const normalized = cache ?? {};
  if (normalized === null || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new TypeError('Rito reader session cache must be an object');
  }
  const state = stateFor(normalized);
  if (cache !== undefined) state.requiresPublicationIdentity = true;
  return normalized;
}

export async function prepareReaderSessionCache(cache, data) {
  if (!(data instanceof ArrayBuffer)) {
    throw new TypeError('Rito reader session publication must be an ArrayBuffer');
  }
  const state = stateFor(cache);
  if (!state.requiresPublicationIdentity) return undefined;
  const identity = await publicationIdentity(data);
  const committed = state.publicationIdentity;
  if (committed !== undefined && !samePublicationIdentity(committed, identity)) {
    throw new Error('Rito reader session cache cannot be shared across different publications');
  }
  return identity;
}

export function commitReaderSessionCache(cache, identity, disposeOnConflict) {
  if (identity === undefined) return;
  const state = stateFor(cache);
  if (state.publicationIdentity === undefined) {
    state.publicationIdentity = identity;
    return;
  }
  if (!samePublicationIdentity(state.publicationIdentity, identity)) {
    try {
      disposeOnConflict?.();
    } catch {
      // Preserve the publication identity error after best-effort cleanup.
    }
    throw new Error('Rito reader session cache was committed by a different publication');
  }
}

export function knownFullChapterTextIndicesScopeKey(cache) {
  return stateFor(cache).fullChapterTextIndices.has(FULL_CHAPTER_TEXT_INDICES_SCOPE_KEY)
    ? FULL_CHAPTER_TEXT_INDICES_SCOPE_KEY
    : undefined;
}

export async function createCachedReaderViewRevision(cache, viewRequest, wire, send) {
  const knownScopeKey = knownFullChapterTextIndicesScopeKey(cache);
  const payload = await send({
    kind: 'createViewRevision',
    request: viewRequest,
    wire,
    ...(knownScopeKey !== undefined ? { knownFullChapterTextIndicesScopeKey: knownScopeKey } : {}),
  });
  try {
    if (payload?.kind !== 'createViewRevision') {
      throw new Error(
        `Rito reader worker returned ${String(payload?.kind)} for createViewRevision`,
      );
    }
    return hydrateReaderViewRevision(cache, payload.result, knownScopeKey);
  } catch (error) {
    await releaseInvalidRevision(send, payload?.result);
    throw error;
  }
}

export function hydrateReaderViewRevision(cache, view, requestedScopeKey) {
  const bundle = requireObject(view?.result?.bundle, 'view revision bundle');
  const revision = requireObject(bundle.revision, 'view revision summary');
  const transport = requireObject(bundle.chapterTextIndices, 'view revision chapter text indices');
  const revisionId = requireNonEmptyString(transport.revisionId, 'chapter text revisionId');
  if (revisionId !== revision.revisionId) {
    throw new Error('Reader chapter text indices revision does not match the revision bundle');
  }

  if (view.kind === 'preview') {
    if (Object.hasOwn(transport, 'scopeKey')) {
      throw new Error('Reader preview chapter text indices must not declare a cache scope');
    }
    requireEntries(transport);
    return view;
  }
  if (view.kind !== 'full') {
    throw new Error(`Reader view revision returned unsupported kind: ${String(view.kind)}`);
  }
  return hydrateFullViewRevision(cache, view, bundle, transport, revisionId, requestedScopeKey);
}

function hydrateFullViewRevision(cache, view, bundle, transport, revisionId, requestedScopeKey) {
  if (!Object.hasOwn(transport, 'scopeKey')) {
    throw new Error('Reader full chapter text indices are missing their cache scope');
  }
  if (transport.scopeKey !== FULL_CHAPTER_TEXT_INDICES_SCOPE_KEY) {
    throw new Error(
      `Reader full chapter text indices use unknown scope: ${String(transport.scopeKey)}`,
    );
  }

  const entries = hydrateFullEntries(cache, transport, requestedScopeKey);
  return {
    ...view,
    result: {
      ...view.result,
      bundle: {
        ...bundle,
        chapterTextIndices: { revisionId, entries },
      },
    },
  };
}

function hydrateFullEntries(cache, transport, requestedScopeKey) {
  const hasEntries = Object.hasOwn(transport, 'entries');
  if (requestedScopeKey === FULL_CHAPTER_TEXT_INDICES_SCOPE_KEY) {
    if (hasEntries) {
      throw new Error('Reader full chapter text cache hit unexpectedly returned inline entries');
    }
    const cached = stateFor(cache).fullChapterTextIndices.get(requestedScopeKey);
    if (cached === undefined) {
      throw new Error(
        `Reader full chapter text indices reference unknown scope: ${requestedScopeKey}`,
      );
    }
    return parseEntriesSnapshot(cached);
  }
  if (requestedScopeKey !== undefined) {
    throw new Error(`Reader requested an unknown chapter text cache scope: ${requestedScopeKey}`);
  }
  if (!hasEntries) {
    throw new Error(
      `Reader full chapter text indices reference unknown scope: ${FULL_CHAPTER_TEXT_INDICES_SCOPE_KEY}`,
    );
  }
  const entries = requireEntries(transport);
  stateFor(cache).fullChapterTextIndices.set(
    FULL_CHAPTER_TEXT_INDICES_SCOPE_KEY,
    createEntriesSnapshot(entries),
  );
  return entries;
}

async function releaseInvalidRevision(send, view) {
  const revisionId = view?.result?.bundle?.revision?.revisionId;
  if (typeof revisionId !== 'string' || revisionId.length === 0) return;
  try {
    await send({ kind: 'releaseRevision', revisionId });
  } catch {
    // Preserve the transport validation error after best-effort cleanup.
  }
}

function createEntriesSnapshot(entries) {
  try {
    const snapshot = JSON.stringify(entries);
    if (snapshot === undefined) throw new Error('entries are not JSON-serializable');
    return snapshot;
  } catch (error) {
    throw new Error(
      `Reader chapter text index entries cannot be cached: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function parseEntriesSnapshot(snapshot) {
  try {
    return requireEntries({ entries: JSON.parse(snapshot) });
  } catch (error) {
    throw new Error(
      `Reader chapter text index cache is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function requireEntries(transport) {
  return requireObject(transport.entries, 'chapter text index entries');
}

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Reader ${label} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Reader ${label} must be a non-empty string`);
  }
  return value;
}

function stateFor(cache) {
  let state = sessionCacheState.get(cache);
  if (state === undefined) {
    state = {
      fullChapterTextIndices: new Map(),
      publicationIdentity: undefined,
      requiresPublicationIdentity: false,
    };
    sessionCacheState.set(cache, state);
  }
  return state;
}

async function publicationIdentity(data) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    return { kind: 'sha256', bytes: new Uint8Array(await subtle.digest('SHA-256', data)) };
  }
  return { kind: 'bytes', bytes: new Uint8Array(data.slice(0)) };
}

function samePublicationIdentity(left, right) {
  if (left.kind !== right.kind || left.bytes.length !== right.bytes.length) return false;
  let difference = 0;
  for (let index = 0; index < left.bytes.length; index += 1) {
    difference |= left.bytes[index] ^ right.bytes[index];
  }
  return difference === 0;
}
