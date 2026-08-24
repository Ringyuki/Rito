import { pinnedFontPolicyJson } from './reader-worker-test-fixture.mjs';

export function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

export function rangeRequest(overrides = {}) {
  return {
    pageIndex: 4,
    start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 1 },
    end: { blockIndex: 0, lineIndex: 1, runIndex: 0, charIndex: 3 },
    ...overrides,
  };
}

export function pageTextPositions(overrides = {}) {
  return {
    revisionId: 'rev-1',
    pageIndex: 4,
    spreadIndex: 2,
    text: 'Hello\nworld',
    textLength: 11,
    textHash: '0123456789abcdef',
    offsets: textOffsets(),
    ...overrides,
  };
}

export function textOffsets() {
  return [
    { start: 0, end: 5, blockIndex: 0, lineIndex: 0, runIndex: 0 },
    { start: 6, end: 11, blockIndex: 0, lineIndex: 1, runIndex: 0 },
  ];
}

export function overlappingOffsets() {
  return [{ ...textOffsets()[0], end: 7 }, textOffsets()[1]];
}

export function invalidGapOffsets() {
  return [textOffsets()[0], { ...textOffsets()[1], start: 7 }];
}

export function crossLineOffsetsWithoutLf() {
  return [textOffsets()[0], { ...textOffsets()[1], start: 5, end: 10 }];
}

export function sameLineOffsetsWithLf() {
  return [textOffsets()[0], { ...textOffsets()[1], lineIndex: 0, runIndex: 1 }];
}

export function textRangeGeometry(overrides = {}) {
  const rects = [rangeRect(0, 0, 0, 1, 5), rangeRect(0, 1, 0, 0, 3)];
  const value = {
    revisionId: 'rev-1',
    pageIndex: 4,
    spreadIndex: 2,
    rectCount: rects.length,
    rects,
    ...overrides,
  };
  return Object.hasOwn(overrides, 'rects') && !Object.hasOwn(overrides, 'rectCount')
    ? { ...value, rectCount: overrides.rects.length }
    : value;
}

export function rangeRect(blockIndex, lineIndex, runIndex, startCharIndex, endCharIndex) {
  return {
    x: lineIndex * 20,
    y: lineIndex * 10,
    width: 16,
    height: 10,
    blockIndex,
    lineIndex,
    runIndex,
    startCharIndex,
    endCharIndex,
  };
}

export function geometryDiagnostic(overrides = {}) {
  return {
    request: overrides.request ?? rangeRequest(),
    geometry: overrides.geometry ?? textRangeGeometry(),
  };
}

export function pagePositionsRequest() {
  return { kind: 'getPageTextPositionsAtRevision', revision: handle(1), pageIndex: 4 };
}

export function geometryRequest(requestOverrides = {}) {
  return {
    kind: 'getTextRangeGeometryAtRevision',
    revision: handle(1),
    request: rangeRequest(requestOverrides),
  };
}

export function positionsDocument(response) {
  return { getPageTextPositionsAtRevision: () => response };
}

export function geometryDocument(response) {
  return { getTextRangeGeometryAtRevision: () => response };
}

export function rawTextGeometryDocument(calls) {
  return new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      getPageTextPositionsAtRevisionJson: (_revisionId, version) =>
        envelope(version, pageTextPositions()),
      getTextRangeGeometryAtRevisionJson: (_revisionId, version) =>
        envelope(version, textRangeGeometry()),
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

function envelope(version, value) {
  return JSON.stringify({ revision: handle(version), value });
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
