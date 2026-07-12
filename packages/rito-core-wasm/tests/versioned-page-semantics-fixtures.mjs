import { pinnedFontPolicyJson } from './reader-worker-test-fixture.mjs';

export function handle(revisionVersion = 1) {
  return { revisionId: 'rev-1', revisionVersion };
}

export function pageSemantics(overrides = {}) {
  return {
    revisionId: 'rev-1',
    pageIndex: 4,
    spreadIndex: 2,
    nodes: [
      semanticNode({
        role: 'heading',
        level: 2,
        text: 'Title',
        children: [semanticNode({ text: 'Title' })],
      }),
      semanticNode({
        role: 'paragraph',
        text: 'Read cover',
        children: [
          semanticNode({ text: 'Read ' }),
          semanticNode({ role: 'link', text: 'cover', href: '#cover' }),
          semanticNode({
            role: 'link',
            href: '#cover',
            children: [semanticNode({ role: 'image', alt: '' })],
          }),
          semanticNode({ role: 'image' }),
        ],
      }),
      semanticNode({
        role: 'list',
        children: [semanticNode({ role: 'listitem', text: 'Item' })],
      }),
      semanticNode({ role: 'blockquote', text: 'Quote' }),
      semanticNode({ role: 'table' }),
    ],
    ...overrides,
  };
}

export function semanticNode(overrides = {}) {
  return {
    role: 'generic',
    bounds: { x: -2, y: 3, width: 20, height: 10 },
    children: [],
    ...overrides,
  };
}

export function mutatePageSemantics(mutate) {
  const value = structuredClone(pageSemantics());
  mutate(value);
  return value;
}

export function rawPageSemanticsDocument(calls = []) {
  return new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      getPageSemanticsAtRevisionJson: (_revisionId, version, pageIndex) =>
        JSON.stringify({
          revision: handle(version),
          value: pageSemantics({ pageIndex }),
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
