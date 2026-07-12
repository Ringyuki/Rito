import { pinnedFontPolicyJson } from './reader-worker-test-fixture.mjs';

export function anchorHandle(revisionVersion = 1) {
  return { revisionId: 'rev-1', revisionVersion };
}

export function pageReadingAnchor(overrides = {}) {
  return {
    status: 'resolved',
    revisionId: 'rev-1',
    pageIndex: 4,
    spreadIndex: 2,
    locator: {
      href: 'Text/chapter.xhtml',
      sourcePoint: { nodePath: [1, 2, 0], textOffset: 8 },
      progression: 0.25,
    },
    ...overrides,
  };
}

export function unavailablePageReadingAnchor(reason = 'noSourceContent', overrides = {}) {
  return {
    status: 'unavailable',
    revisionId: 'rev-1',
    pageIndex: 4,
    spreadIndex: 2,
    reason,
    ...overrides,
  };
}

export function mutatePageReadingAnchor(mutate) {
  const value = structuredClone(pageReadingAnchor());
  mutate(value);
  return value;
}

export function rawPageReadingAnchorDocument(calls = []) {
  return new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      getPageReadingAnchorAtRevisionJson: (_revisionId, version, pageIndex) =>
        JSON.stringify({
          revision: anchorHandle(version),
          value: pageReadingAnchor({ pageIndex }),
        }),
    },
    {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => {
          calls.push([property, args]);
          return value(...args);
        };
      },
    },
  );
}
