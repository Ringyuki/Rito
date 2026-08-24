import { describe, expect, it } from 'vitest';
import { createReader as createRootReader } from '../../src/index';
import { createReader as createReferenceReader } from '../../src/reference';
import { createReader as createWebCompatibilityReader } from '../../src/compatibility/web';

describe('TypeScript reference core facade', () => {
  it('keeps the reference reader separate from the root production reader', () => {
    expect(createReferenceReader).not.toBe(createRootReader);
  });

  it('serves the production Rust-core reader through the web compatibility preset', () => {
    // `@ritojs/core/web` is the published 0.13 entry point real readers
    // import from; it must hand out the production pipeline, not the
    // frozen TS reference (same createReader contract either way).
    expect(createWebCompatibilityReader).toBe(createRootReader);
    expect(createWebCompatibilityReader).not.toBe(createReferenceReader);
  });
});
