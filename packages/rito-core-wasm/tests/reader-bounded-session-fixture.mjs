export function fixtureClient(overrides) {
  const extents = new Map();
  const revisions = new Map();
  const track = async (operation, ...args) => {
    const response = await operation(...args);
    const value = response?.value?.revision ?? response?.value;
    if (value?.knownExtent !== undefined) {
      extents.set(response.revision.revisionVersion, value.knownExtent);
      revisions.set(response.revision.revisionVersion, value);
    }
    return response;
  };
  return {
    createBoundedRevision: (...args) => track(overrides.create, ...args),
    continueRevision: (...args) => track(overrides.continue, ...args),
    cancelRevision:
      overrides.cancel === undefined
        ? (value) =>
            track(async () => versionedSummary(summary(value.revisionVersion + 1, 'cancelled', 0)))
        : (...args) => track(overrides.cancel, ...args),
    getRevisionBundleAtRevision: async (value, includeTocTargets) => {
      const extent = extents.get(value.revisionVersion);
      if (overrides.bundle !== undefined) {
        return overrides.bundle(value, extent, includeTocTargets);
      }
      const navigation =
        overrides.navigation === undefined
          ? { revision: value, value: { revisionId: value.revisionId, ...extent } }
          : await overrides.navigation(value, extent, includeTocTargets);
      return {
        revision: navigation.revision,
        value: revisionBundle(revisions.get(value.revisionVersion), navigation.value),
      };
    },
    warmFrameWindowAtRevision: async (value, spreadIndex) => ({
      revision: value,
      value: overrides.warm?.(value, spreadIndex) ?? { spreadIndex },
    }),
    releaseRevisionTransfersAtRevision: async (value) => {
      await overrides.releaseTransfers?.(value);
      return { revision: value, value: 0 };
    },
    releaseRevisionAtRevision: async (value) => {
      await overrides.release?.(value);
      if (overrides.releaseResponse !== undefined) return overrides.releaseResponse(value);
      return {
        revision: value,
        value: { releasedRevision: true, releasedTransferCount: 0 },
      };
    },
  };
}

export function revisionBundle(revision, navigation, chapterTextEntries = {}) {
  return {
    revision,
    navigation,
    tocTargets: { revisionId: revision.revisionId, targets: [] },
    footnotes: { revisionId: revision.revisionId, entries: {} },
    chapterTextIndices: { revisionId: revision.revisionId, entries: chapterTextEntries },
    fontFamilies: [],
  };
}

export function startRequest(targetSpreadIndex) {
  return {
    layoutConfig: {},
    budget: { maxTopLevelNodes: 1 },
    targetSpreadIndex,
  };
}

export function advance(version, spreadCount, continuing) {
  const revision = summary(version, continuing ? 'ready' : 'complete', spreadCount);
  return {
    revision,
    previousKnownExtent: { pageCount: 0, spreadCount: 0 },
    newlyKnownPages: { startPage: 0, endPageExclusive: spreadCount },
    processedTopLevelNodes: 1,
    ...(continuing
      ? { continuation: { ...handle(version), cursor: `cursor-${String(version + 1)}` } }
      : {}),
  };
}

export function summary(version, status, spreadCount) {
  const knownExtent = { pageCount: spreadCount, spreadCount };
  return {
    ...handle(version),
    layoutKey: 'layout',
    status,
    knownExtent,
    ...(status === 'complete' ? { finalExtent: knownExtent } : {}),
    pageCount: spreadCount,
    spreadCount,
  };
}

export function versioned(value) {
  return { revision: handle(value.revision.revisionVersion), value };
}

export function versionedSummary(value) {
  return { revision: handle(value.revisionVersion), value };
}

export function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

export function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
