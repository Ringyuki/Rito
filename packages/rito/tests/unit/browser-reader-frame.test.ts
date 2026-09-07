import { describe, expect, it, vi } from 'vitest';
import type { DecodedRitoFrameCommandBuffer } from '@ritojs/core-wasm';

import { decodeBrowserReaderFrame } from '../../src/bindings/browser/reader/frame';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import type { BrowserReaderFrameBuffer } from '../../src/bindings/browser/core-contracts';

describe('browser reader frame decoding', () => {
  it('decodes a matching packed frame buffer', () => {
    const decodeFrameCommandBuffer = createDecoder();
    const frame = decodeBrowserReaderFrame(
      decodeFrameCommandBuffer,
      'rev-1',
      2,
      frameBuffer({ revisionId: 'rev-1', spreadIndex: 2 }),
    );

    expect(frame).toEqual({
      revisionId: 'rev-1',
      spreadIndex: 2,
      width: 800,
      height: 600,
      ratio: 2,
      commands: [pageGround()],
      commandHash: 'metadata-hash',
      resourceRefs: { images: ['images/cover.jpg'] },
      fontFamilies: ['BookFont'],
      imageDominated: true,
    });
    expect(decodeFrameCommandBuffer).toHaveBeenCalledOnce();
  });

  it('rejects a buffer from a different revision before decoding', () => {
    const decodeFrameCommandBuffer = createDecoder();

    expect(() =>
      decodeBrowserReaderFrame(
        decodeFrameCommandBuffer,
        'rev-2',
        0,
        frameBuffer({ revisionId: 'rev-1', spreadIndex: 0 }),
      ),
    ).toThrow('Reader frame buffer revision mismatch');
    expect(decodeFrameCommandBuffer).not.toHaveBeenCalled();
  });

  it('rejects a buffer from a different spread before decoding', () => {
    const decodeFrameCommandBuffer = createDecoder();

    expect(() =>
      decodeBrowserReaderFrame(
        decodeFrameCommandBuffer,
        'rev-1',
        1,
        frameBuffer({ revisionId: 'rev-1', spreadIndex: 0 }),
      ),
    ).toThrow('Reader frame buffer spread mismatch');
    expect(decodeFrameCommandBuffer).not.toHaveBeenCalled();
  });

  it('uses Rust frame metadata for non-command frame fields', () => {
    const decodeFrameCommandBuffer = createDecoder({
      commandHash: 'decoded-other-hash',
      resourceTable: ['decoded-other.jpg'],
    });
    const frame = decodeBrowserReaderFrame(
      decodeFrameCommandBuffer,
      'rev-1',
      2,
      frameBuffer({ revisionId: 'rev-1', spreadIndex: 2 }),
    );

    expect(frame.commandHash).toBe('metadata-hash');
    expect(frame.resourceRefs.images).toEqual(['images/cover.jpg']);
    expect(frame.fontFamilies).toEqual(['BookFont']);
  });
});

function createDecoder(
  overrides: Partial<DecodedRitoFrameCommandBuffer> = {},
): BrowserReaderState['decodeFrameCommandBuffer'] {
  return vi.fn(
    (): DecodedRitoFrameCommandBuffer => ({
      ...decodedFrameCommandBuffer(),
      ...overrides,
    }),
  );
}

function decodedFrameCommandBuffer(): DecodedRitoFrameCommandBuffer {
  return {
    protocolVersion: 2,
    ratio: 2,
    commandCount: 1,
    commandCounts: { paintPage: 1 },
    primitiveCount: 1,
    commandHash: 'decoded-hash',
    resourceRefCount: 1,
    resourceTable: ['images/cover.jpg'],
    commands: [pageGround()],
  };
}

function pageGround(): DecodedRitoFrameCommandBuffer['commands'][number] {
  return {
    kind: 'fill-rect',
    rect: { x: 0, y: 0, width: 1600, height: 1200 },
    color: {
      space: 'srgb',
      component0: 1,
      component1: 1,
      component2: 1,
      alpha: 1,
      none: { component0: false, component1: false, component2: false, alpha: false },
    },
    ground: 'page',
  };
}

function frameBuffer(input: {
  readonly revisionId: string;
  readonly spreadIndex: number;
}): BrowserReaderFrameBuffer {
  return {
    metadata: {
      revisionId: input.revisionId,
      spreadIndex: input.spreadIndex,
      width: 800,
      height: 600,
      protocolVersion: 2,
      ratio: 2,
      commandCount: 1,
      commandCounts: { paintPage: 1 },
      primitiveCount: 1,
      byteLength: 23,
      commandHash: 'metadata-hash',
      resourceRefCount: 1,
      resourceTable: ['images/cover.jpg'],
      fontFamilies: ['BookFont'],
      imageDominated: true,
    },
    bytes: new Uint8Array(23),
  };
}
