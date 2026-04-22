// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { LayoutBlock, Page } from '../../src/layout/core';
import { createLayoutConfig } from '../../src/layout/core/config';
import { renderPage } from '../../src/render/page';
import { loadEpub } from '../../src/runtime/load-epub';
import { paginate } from '../../src/runtime/paginate';
import type { EpubDocument } from '../../src/runtime/types';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { buildMinimalEpub } from '../helpers/epub-builder';

const CONFIG = createLayoutConfig({ width: 360, height: 480, margin: 24 });

describe('focused render feature chain', () => {
  it('carries block opacity from EPUB CSS through layout into Canvas commands', () => {
    const page = paginateFirstPage(`
      <div style="opacity: 0.5; background-color: #ffeeaa; padding: 8px">
        <p>Faded block text should render with opacity.</p>
      </div>
    `);
    const fadedBlock = findBlock(page.content, (block) => block.paint?.opacity === 0.5);
    expect(fadedBlock?.paint?.opacity).toBe(0.5);

    const mock = createMockCanvasContext();
    renderPage(page, mock.ctx, CONFIG, { backgroundColor: '#ffffff' });

    const alphaSets = mock.getPropertySets('globalAlpha').map((record) => record.value);
    expect(alphaSets).toContain(0.5);
  });
});

function paginateFirstPage(body: string): Page {
  const document = loadEpub(
    buildMinimalEpub({
      chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml(body) }],
    }),
  );
  try {
    const page = paginateDocument(document)[0];
    if (!page) throw new Error('Expected focused EPUB to produce a page');
    return page;
  } finally {
    document.close();
  }
}

function paginateDocument(document: EpubDocument): readonly Page[] {
  return paginate(document, CONFIG, createMockTextMeasurer(0.6));
}

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Focused Render Feature</title></head>
  <body>${body}</body>
</html>`;
}

function findBlock(
  blocks: readonly LayoutBlock[],
  predicate: (block: LayoutBlock) => boolean,
): LayoutBlock | undefined {
  for (const block of blocks) {
    if (predicate(block)) return block;
    const child = findBlockChildren(block, predicate);
    if (child) return child;
  }
  return undefined;
}

function findBlockChildren(
  block: LayoutBlock,
  predicate: (block: LayoutBlock) => boolean,
): LayoutBlock | undefined {
  for (const child of block.children) {
    if (child.type !== 'layout-block') continue;
    if (predicate(child)) return child;
    const nested = findBlockChildren(child, predicate);
    if (nested) return nested;
  }
  return undefined;
}
