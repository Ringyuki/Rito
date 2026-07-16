import { pinnedFontPolicyJson } from './reader-worker-test-fixture.mjs';

export function handle(revisionVersion = 1) {
  return { revisionId: 'rev-1', revisionVersion };
}

export function pointRequest(overrides = {}) {
  return { pageIndex: 4, x: 12.5, y: 24.25, ...overrides };
}

export function caretAddress(overrides = {}) {
  return {
    pageIndex: 4,
    blockIndex: 0,
    lineIndex: 0,
    runIndex: 0,
    charIndex: 1,
    affinity: 'downstream',
    ...overrides,
  };
}

export function caretResponse(overrides = {}) {
  return {
    revisionId: 'rev-1',
    pageIndex: 4,
    spreadIndex: 2,
    resolution: resolvedCaret(),
    ...overrides,
  };
}

export function resolvedCaret(overrides = {}) {
  return {
    status: 'resolved',
    caret: {
      address: caretAddress(),
      geometry: { x: 10, y: 20, height: 16 },
      sourceLocator: {
        href: 'Text/chapter.xhtml',
        sourcePoint: { nodePath: [1, 0], textOffset: 3 },
      },
      ...overrides,
    },
  };
}

export function rangeRequest(overrides = {}) {
  return {
    anchor: caretAddress({ charIndex: 1 }),
    focus: caretAddress({ pageIndex: 5, lineIndex: 1, charIndex: 2 }),
    ...overrides,
  };
}

export function rangeResponse(request = rangeRequest(), overrides = {}) {
  return {
    revisionId: 'rev-1',
    resolution: {
      status: 'resolved',
      range: {
        anchor: request.anchor,
        focus: request.focus,
        start: request.anchor,
        end: request.focus,
        selectedText: 'i\n\nTe',
        sourceLocator: {
          href: 'Text/chapter.xhtml',
          sourceRange: {
            start: { nodePath: [1, 0], textOffset: 3 },
            end: { nodePath: [2, 0], textOffset: 2 },
          },
        },
        rects: [
          exactRect(),
          exactRect({
            pageIndex: 5,
            spreadIndex: 3,
            y: 4,
            lineIndex: 1,
            startCharIndex: 0,
            endCharIndex: 2,
          }),
        ],
      },
    },
    ...overrides,
  };
}

export function exactRect(overrides = {}) {
  return {
    pageIndex: 4,
    spreadIndex: 2,
    x: 10,
    y: 2,
    width: 8,
    height: 16,
    blockIndex: 0,
    lineIndex: 0,
    runIndex: 0,
    startCharIndex: 1,
    endCharIndex: 2,
    ...overrides,
  };
}

export function caretTransport(request = pointRequest(), response = caretResponse()) {
  return { request, response };
}

export function rangeTransport(request = rangeRequest(), response = rangeResponse(request)) {
  return { request, response };
}

export function rawExactTextDocument(calls) {
  return new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      resolveTextCaretAtRevisionJson: (_revisionId, version) => envelope(version, caretResponse()),
      resolveTextRangeAtRevisionJson: (_revisionId, version, requestJson) => {
        const request = JSON.parse(requestJson);
        return envelope(version, rangeResponse(request));
      },
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

export class ManualWorker {
  listeners = new Map();
  messages = [];

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {}

  respondLast(payload) {
    const { id } = this.messages.at(-1);
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: { id, ok: true, payload } });
    }
  }
}

function envelope(revisionVersion, value) {
  return JSON.stringify({ revision: handle(revisionVersion), value });
}
