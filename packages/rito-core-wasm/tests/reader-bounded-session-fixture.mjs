export function fixtureClient(overrides) {
  const extents = new Map();
  const revisions = new Map();
  const track = async (operation, ...args) => {
    const response = await operation(...args);
    const value = response?.value?.revision ?? response?.value;
    if (value?.layoutKey !== undefined && value?.pageCount !== undefined) {
      extents.set(response.revision.revisionVersion, {
        pageCount: value.pageCount,
        spreadCount: value.spreadCount,
      });
      revisions.set(response.revision.revisionVersion, value);
    }
    return response;
  };
  return {
    createBoundedRevision: (...args) => track(overrides.create, ...args),
    getRevisionPresentationAtRevision: async (value) => {
      const extent = extents.get(value.revisionVersion);
      if (overrides.presentation !== undefined) {
        return overrides.presentation(value, extent, revisions.get(value.revisionVersion));
      }
      const navigation =
        overrides.navigation === undefined
          ? { revision: value, value: revisionNavigation(value.revisionId, extent) }
          : await overrides.navigation(value, extent);
      return {
        revision: navigation.revision,
        value: revisionPresentation(revisions.get(value.revisionVersion), navigation.value),
      };
    },
    warmFrameWindowAtRevision: async (value, spreadIndex) => ({
      revision: value,
      value: overrides.warm?.(value, spreadIndex) ?? { spreadIndex },
    }),
    resolveSourceLocatorAtRevision: async (value, locator) => ({
      revision: value,
      value:
        (await overrides.locator?.(value, locator, extents.get(value.revisionVersion))) ??
        sourceResolution(value, locator, extents.get(value.revisionVersion)),
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

export function revisionPresentation(revision, navigation) {
  return {
    revision,
    navigation,
    tocTargets: { revisionId: revision.revisionId, targets: [] },
    fontFamilies: [],
  };
}

export function revisionNavigation(revisionId, extent) {
  return {
    revisionId,
    ...extent,
    spreads: Array.from({ length: extent.spreadCount }, (_, spreadIndex) => ({
      spreadIndex,
      pageIndexes: [spreadIndex],
      leftPageIndex: spreadIndex,
    })),
    chapters: [],
    chapterMap: {},
  };
}

export function sourceResolution(revision, locator, extent, spreadIndex = 0) {
  if (extent.spreadCount === 0) {
    return {
      status: 'pending',
      revisionId: revision.revisionId,
      locator,
      spineIdref: 'chapter',
      reason: 'noPageProjection',
      matchedBy: 'href',
    };
  }
  return {
    status: 'resolved',
    revisionId: revision.revisionId,
    locator,
    spineIdref: 'chapter',
    pageIndex: spreadIndex,
    spreadIndex,
    matchedBy: 'href',
  };
}

export function startRequest(targetSpreadIndex) {
  return { layoutConfig: {}, targetSpreadIndex };
}

export function locatorStartRequest(targetLocator) {
  return { layoutConfig: {}, targetLocator };
}

export function summary(version, spreadCount) {
  return {
    ...handle(version),
    layoutKey: 'layout',
    pageCount: spreadCount,
    spreadCount,
  };
}

export function versioned(summary) {
  return { revision: handle(summary.revisionVersion), value: summary };
}

export function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}
