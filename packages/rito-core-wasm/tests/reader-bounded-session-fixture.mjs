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
  const releasedHandle = (request) => ({
    revisionId: request.revisionId,
    revisionVersion: request.revisionVersion,
  });
  const atomicMethods =
    overrides.atomic === false
      ? {}
      : {
          continueRevisionAfterTransferRelease: async (request) => {
            const releasedRevision = releasedHandle(request);
            const continued = await track(overrides.continue, request);
            await overrides.releaseTransfers?.(releasedRevision);
            return {
              revision: continued.revision,
              value: {
                advance: continued.value,
                releasedRevision,
                releasedTransferCount: 0,
              },
            };
          },
          continueRevisionTowardSourceLocator: async (request) => {
            const releasedRevision = releasedHandle(request);
            const continued = await track(overrides.continue, request);
            await overrides.releaseTransfers?.(releasedRevision);
            let locatorOutcome;
            try {
              const extent = extents.get(continued.revision.revisionVersion);
              const resolution =
                (await overrides.locator?.(continued.revision, request.locator, extent)) ??
                sourceResolution(continued.revision, request.locator, extent);
              locatorOutcome = { kind: 'resolved', resolution };
            } catch (error) {
              locatorOutcome = {
                kind: 'failed',
                code: error?.code ?? 'internal-error',
                message: error instanceof Error ? error.message : String(error),
                ...(error?.revision !== undefined ? { revision: error.revision } : {}),
              };
            }
            return {
              revision: continued.revision,
              value: {
                advance: continued.value,
                releasedRevision,
                releasedTransferCount: 0,
                request: request.locator,
                canonicalRequest: request.locator,
                locatorOutcome,
              },
            };
          },
        };
  const calibrate = async (request) => {
    if (overrides.calibrate !== undefined) return overrides.calibrate(request);
    const previous = revisions.get(request.revisionVersion);
    const revision = {
      ...previous,
      revisionVersion: request.revisionVersion + 1,
    };
    return {
      revision: handle(revision.revisionVersion),
      value: {
        revision,
        ...(revision.status === 'complete'
          ? {}
          : {
              continuation: {
                ...handle(revision.revisionVersion),
                cursor: `cursor-${String(revision.revisionVersion + 1)}`,
              },
            }),
        calibratedPublishedRunCount: 1,
        calibratedUnpublishedRunCount: 0,
        releasedRevision: releasedHandle(request),
        releasedTransferCount: 0,
      },
    };
  };
  return {
    createBoundedRevision: (...args) => track(overrides.create, ...args),
    continueRevision: (...args) => track(overrides.continue, ...args),
    ...atomicMethods,
    calibrateRevisionFontVerticalMetrics: (...args) => track(calibrate, ...args),
    cancelRevision:
      overrides.cancel === undefined
        ? (value) =>
            track(async () => versionedSummary(summary(value.revisionVersion + 1, 'cancelled', 0)))
        : (...args) => track(overrides.cancel, ...args),
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

export function startRequest(targetSpreadIndex, budget = 1, growthBudget = 32) {
  return {
    layoutConfig: {},
    budget: { maxTopLevelNodes: budget },
    growthBudget: { maxTopLevelNodes: growthBudget },
    targetSpreadIndex,
  };
}

export function locatorStartRequest(targetLocator, budget = 32, growthBudget = 32) {
  return {
    layoutConfig: {},
    budget: { maxTopLevelNodes: budget },
    growthBudget: { maxTopLevelNodes: growthBudget },
    targetLocator,
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
  let reject;
  const promise = new Promise((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}
