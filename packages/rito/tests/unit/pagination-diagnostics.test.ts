// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createLayoutConfig } from '../../src/layout/core/config';
import { loadEpub } from '../../src/runtime/load-epub';
import { paginateWithMeta } from '../../src/runtime/paginate';
import type { Logger } from '../../src/utils/logger';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { buildMinimalEpub } from '../helpers/epub-builder';

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('pagination diagnostics', () => {
  it('logs XHTML parse warnings through the provided logger', () => {
    const logger = createMockLogger();
    const doc = loadEpub(
      buildMinimalEpub({
        chapters: [
          {
            id: 'ch1',
            href: 'chapter1.xhtml',
            content: xhtml('<p>text</p><script>alert("x")</script><style>.x{}</style>'),
          },
        ],
      }),
      { logger },
    );

    paginateWithMeta(
      doc,
      createLayoutConfig({ width: 400, height: 600, margin: 20 }),
      createMockTextMeasurer(0.6),
      undefined,
      undefined,
      logger,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'XHTML parse warning in %s: %s',
      'ch1',
      'Unsupported element <script> skipped',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'XHTML parse warning in %s: %s',
      'ch1',
      'Unsupported element <style> skipped',
    );
  });
});
