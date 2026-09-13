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
  const committed = state.sessionIdentity?.publicationIdentity;
  if (committed !== undefined && !samePublicationIdentity(committed, identity)) {
    throw new Error('Rito reader session cache cannot be shared across different publications');
  }
  return identity;
}

export function commitReaderSessionCache(cache, publicationIdentity, policyId, disposeOnConflict) {
  if (publicationIdentity === undefined) return;
  const state = stateFor(cache);
  const committed = state.sessionIdentity;
  if (committed === undefined) {
    state.sessionIdentity = { publicationIdentity, policyId };
    return;
  }
  if (!samePublicationIdentity(committed.publicationIdentity, publicationIdentity)) {
    disposeConflictingSession(disposeOnConflict);
    throw new Error('Rito reader session cache was committed by a different publication');
  }
  if (committed.policyId !== policyId) {
    disposeConflictingSession(disposeOnConflict);
    throw new Error('Rito reader session cache was committed by a different pinned font policy');
  }
}

function disposeConflictingSession(disposeOnConflict) {
  try {
    disposeOnConflict?.();
  } catch {
    // Preserve the cache identity error after best-effort cleanup.
  }
}

function stateFor(cache) {
  let state = sessionCacheState.get(cache);
  if (state === undefined) {
    state = {
      sessionIdentity: undefined,
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
